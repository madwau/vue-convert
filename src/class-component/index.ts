/// <reference path="../vendor/recast.d.ts" />

import * as recast from 'recast';
import { Options as RecastOptions } from 'recast/lib/options';
import * as parser from 'recast/parsers/babylon';
import * as t from '@babel/types';
import { ClassMember, findProperty, literalKey, spreadTodoMethod, todoClassMember } from '../nodes/utils';

import { convertGenericProperty } from './asis';
import { convertComputed } from './computed';
import { convertAndModifyData } from './data';
import { convertArrayProps, convertProps } from './props';
import { convertMethods } from './methods';
import flatMap = require('lodash.flatmap');

// TODO: if name is not UpperCamelCase, use name option.
// name?: string;
// TODO: support properly inferred 'extends'
// extends?: ComponentOptions<Vue> | typeof Vue;
// TODO: Support watch
const COMPONENT_OPTION_NAMES = [
  'watch',
  'el',
  'template',
  'directives',
  'components',
  'transitions',
  'filters',
  'inject',
  'model',
  // TODO: support class-style mixins https://github.com/vuejs/vue-class-component#using-mixins
  'mixins',
  'name',
  'extends',
  'delimiters',
  'comments',
  'inheritAttrs',
  // vue-router
  'route',
  // Vue SSR
  'serverCacheKey',
];
const COMPONENT_OPTION_NAME_SET = new Set(COMPONENT_OPTION_NAMES);

const RECAST_OPTIONS: RecastOptions = {
  quote: 'single',
  trailingComma: true,
};

export function convertComponentSourceToClass(source: string, file: string): string | null {
  const ast = recast.parse(source, { parser });

  const exported = ast.program.body.find(node => t.isExportDefaultDeclaration(node)) as t.ExportDefaultDeclaration;

  if (!exported) {
    console.warn(`${file}: No export default declration found.`);
    return null;
  }

  if (t.isClassDeclaration(exported.declaration)) {
    console.warn(`${file}: Already has default exported class declration.`);
    return null;
  }

  if (!t.isObjectExpression(exported.declaration)) {
    console.warn(`${file}: export default it not object expression.`);
    return null;
  }

  const { classDeclaration, importNames } = convertComponentToClass(exported.declaration);
  exported.declaration = classDeclaration;

  // Add: import { Vue, Component, Prop } from 'vue-property-decorator'
  ast.program.body.unshift(writeImport(importNames));

  removeNotNeededImports(ast);

  const code = recast.print(ast, RECAST_OPTIONS).code;

  return postProcessCode(code);
}

function writeImport(names: string[]): t.ImportDeclaration {
  return t.importDeclaration(
    names.map(name => t.importSpecifier(t.identifier(name), t.identifier(name))),
    t.stringLiteral('vue-property-decorator'),
  );
}

function convertComponentToClass(
  componentAst: t.ObjectExpression,
): { classDeclaration: t.ClassDeclaration; importNames: string[] } {
  const nameProperty = findProperty(componentAst, 'name');
  let name = 'AnonymousComponent';
  if (nameProperty && t.isStringLiteral(nameProperty.value)) {
    name = nameProperty.value.value;
  }
  const className = name.replace(/(?:^|-)(\w)/g, (_, p1) => p1.toUpperCase()); // UpperCamzelize

  const { classMembers, decoratorNames } = convertComponentBody(componentAst);

  const classDeclaration = t.classDeclaration(
    t.identifier(className),
    t.identifier('Vue'), // superClass
    t.classBody(classMembers),
    [writeDecorator(componentAst, name === className)],
  );

  return { classDeclaration, importNames: ['Vue', 'Component'].concat(decoratorNames) };
}

function isComponentOption(property: t.ObjectProperty | t.ObjectMethod | t.SpreadElement): property is t.ObjectMember {
  return !t.isSpreadElement(property) && COMPONENT_OPTION_NAME_SET.has(literalKey(property.key) || '');
}

function writeDecorator(componentAst: t.ObjectExpression, skipName: boolean): t.Decorator {
  const componentOptions = componentAst.properties.filter(p => isComponentOption(p) && !(skipName && p.key === 'name'));
  if (componentOptions.length === 0) return t.decorator(t.identifier('Component'));
  return t.decorator(t.callExpression(t.identifier('Component'), [t.objectExpression(componentOptions)]));
}

function requireObjectExpression(
  member: t.ObjectMember,
  callback: (objectAst: t.ObjectExpression) => ClassMember[],
): ClassMember[] {
  const key = literalKey(member.key) || 'TODO_invalidKey';
  if (t.isObjectProperty(member) && t.isObjectExpression(member.value)) {
    return callback(member.value);
  } else {
    console.warn(`Property "${key}" is not a Object.`);
    return [todoClassMember(member)];
  }
}

function convertComponentBody(
  componentAst: t.ObjectExpression,
): { classMembers: ClassMember[]; decoratorNames: string[] } {
  const componentMembers = componentAst.properties.filter(p => !isComponentOption(p));
  const decoratorNameSet = new Set();

  const classMembers = flatMap(
    componentMembers,
    (member): ClassMember[] => {
      if (t.isSpreadElement(member)) {
        console.warn(
          'Spread property is found in component definition. Automatic conversion of object spread is not supported.',
        );
        return [spreadTodoMethod(member)];
      }

      switch (literalKey(member.key)) {
        case 'data':
          return convertAndModifyData(member);
        case 'methods':
          return requireObjectExpression(member, objectAst => convertMethods(objectAst));
        case 'computed':
          return requireObjectExpression(member, objectAst => convertComputed(objectAst));
        case 'props':
          // TODO: Create option to enable or disable this (vue-property-decorator).
          let props: ClassMember[];
          if (t.isObjectProperty(member) && t.isArrayExpression(member.value)) {
            props = convertArrayProps(member.value);
          } else if (t.isObjectProperty(member) && t.isObjectExpression(member.value)) {
            props = convertProps(member.value);
          } else {
            console.warn(`Property "props" is not a Object or Array.`);
            return [todoClassMember(member)];
          }
          if (props.length > 0) decoratorNameSet.add('Prop');
          return props;
      }
      return convertGenericProperty(member);
    },
  );

  return { classMembers, decoratorNames: [...decoratorNameSet] };
}

function removeNotNeededImports(ast: t.File) {
  // Remove: import Vue from 'vue'
  ast.program.body = ast.program.body.filter(node => {
    return !(
      t.isImportDeclaration(node) &&
      node.source.value === 'vue' &&
      node.specifiers.length === 1 &&
      node.specifiers[0].local.name === 'Vue'
    );
  });

  // Remove: import { mapActions, mapGetters } from 'vuex';
  ast.program.body = ast.program.body.filter(node => {
    return !(t.isImportDeclaration(node) && node.source.value === 'vuex');
  });
}

function postProcessCode(code: string) {
  return singleLineForGettersAndActions(code);
}

function singleLineForGettersAndActions(code: string) {
  const lines = code.split('\n');
  const resultLines: string[] = [];

  const patterns = [/^@.*\.Getter\(.*\)$/, /^@.*\.Action\(.*\)$/];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (patterns.some(pattern => pattern.test(line.trim())) && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      resultLines.push(`${line} ${nextLine.trim()}`);
      i++;
    } else {
      resultLines.push(line);
    }
  }

  return resultLines.join('\n');
}
