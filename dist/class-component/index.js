"use strict";
/// <reference path="../vendor/recast.d.ts" />
Object.defineProperty(exports, "__esModule", { value: true });
const recast = require("recast");
const parser = require("recast/parsers/babylon");
const t = require("@babel/types");
const utils_1 = require("../nodes/utils");
const asis_1 = require("./asis");
const computed_1 = require("./computed");
const data_1 = require("./data");
const props_1 = require("./props");
const methods_1 = require("./methods");
const lodash_1 = require("lodash");
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
const RECAST_OPTIONS = {
    quote: 'single',
    trailingComma: true,
};
function convertComponentSourceToClass(source, file) {
    const ast = recast.parse(source, { parser });
    const exported = ast.program.body.find(node => t.isExportDefaultDeclaration(node));
    if (!exported) {
        console.warn(`${file}: No export default declaration found.`);
        return null;
    }
    if (t.isClassDeclaration(exported.declaration)) {
        console.warn(`${file}: Already has default exported class declaration.`);
        return null;
    }
    if (!t.isObjectExpression(exported.declaration)) {
        console.warn(`${file}: export default it not object expression.`);
        return null;
    }
    const { classDeclaration, importNames } = convertComponentToClass(exported.declaration);
    exported.declaration = classDeclaration;
    // Add: const demosStore = namespace(Demos.type);
    const { numberOfDeclarations: numberOfVuexStoreDeclarations } = addVuexStoreDeclarations(ast);
    // Add: import { Vue, Component, Prop } from 'vue-property-decorator'
    ast.program.body.unshift(writeImport(importNames));
    if (numberOfVuexStoreDeclarations > 0) {
        // Add: import { namespace } from 'vuex-class';
        addVuexClassNamespaceImport(ast);
    }
    removeNotNeededImports(ast);
    sortVueComponentClassMembers(ast);
    const code = recast.print(ast, RECAST_OPTIONS).code;
    return postProcessCode(code);
}
exports.convertComponentSourceToClass = convertComponentSourceToClass;
function writeImport(names) {
    return t.importDeclaration(names.map(name => t.importSpecifier(t.identifier(name), t.identifier(name))), t.stringLiteral('vue-property-decorator'));
}
function convertComponentToClass(componentAst) {
    const nameProperty = utils_1.findProperty(componentAst, 'name');
    let name = 'AnonymousComponent';
    if (nameProperty && t.isStringLiteral(nameProperty.value)) {
        name = nameProperty.value.value;
    }
    const className = name.replace(/(?:^|-)(\w)/g, (_, p1) => p1.toUpperCase()); // UpperCamelize
    const { classMembers, decoratorNames } = convertComponentBody(componentAst);
    const classDeclaration = t.classDeclaration(t.identifier(className), t.identifier('Vue'), // superClass
    t.classBody(classMembers), [writeDecorator(componentAst, name === className)]);
    return { classDeclaration, importNames: ['Vue', 'Component'].concat(decoratorNames) };
}
function isComponentOption(property) {
    return !t.isSpreadElement(property) && COMPONENT_OPTION_NAME_SET.has(utils_1.literalKey(property.key) || '');
}
function writeDecorator(componentAst, skipName) {
    const componentOptions = componentAst.properties.filter(p => isComponentOption(p) && !(skipName && p.key === 'name'));
    if (componentOptions.length === 0)
        return t.decorator(t.identifier('Component'));
    return t.decorator(t.callExpression(t.identifier('Component'), [t.objectExpression(componentOptions)]));
}
function requireObjectExpression(member, callback) {
    const key = utils_1.literalKey(member.key) || 'TODO_invalidKey';
    if (t.isObjectProperty(member) && t.isObjectExpression(member.value)) {
        return callback(member.value);
    }
    else {
        console.warn(`Property "${key}" is not a Object.`);
        return [utils_1.todoClassMember(member)];
    }
}
function convertComponentBody(componentAst) {
    const componentMembers = componentAst.properties.filter(p => !isComponentOption(p));
    const decoratorNameSet = new Set();
    const classMembers = lodash_1.flatMap(componentMembers, (member) => {
        if (t.isSpreadElement(member)) {
            console.warn('Spread property is found in component definition. Automatic conversion of object spread is not supported.');
            return [utils_1.spreadTodoMethod(member)];
        }
        switch (utils_1.literalKey(member.key)) {
            case 'data':
                return data_1.convertAndModifyData(member);
            case 'methods':
                return requireObjectExpression(member, objectAst => methods_1.convertMethods(objectAst));
            case 'computed':
                return requireObjectExpression(member, objectAst => computed_1.convertComputed(objectAst));
            case 'props':
                // TODO: Create option to enable or disable this (vue-property-decorator).
                let props;
                if (t.isObjectProperty(member) && t.isArrayExpression(member.value)) {
                    props = props_1.convertArrayProps(member.value);
                }
                else if (t.isObjectProperty(member) && t.isObjectExpression(member.value)) {
                    props = props_1.convertProps(member.value);
                }
                else {
                    console.warn(`Property "props" is not a Object or Array.`);
                    return [utils_1.todoClassMember(member)];
                }
                if (props.length > 0)
                    decoratorNameSet.add('Prop');
                return props;
        }
        return asis_1.convertGenericProperty(member);
    });
    return { classMembers, decoratorNames: [...decoratorNameSet] };
}
function addVuexClassNamespaceImport(ast) {
    const importDeclaration = t.importDeclaration([t.importSpecifier(t.identifier('namespace'), t.identifier('namespace'))], t.stringLiteral('vuex-class'));
    const vuePropertyDecoratorImportIndex = ast.program.body.findIndex(node => {
        return t.isImportDeclaration(node) && node.source.value === 'vue-property-decorator';
    });
    if (vuePropertyDecoratorImportIndex > -1) {
        ast.program.body.splice(vuePropertyDecoratorImportIndex + 1, 0, importDeclaration);
    }
}
function removeNotNeededImports(ast) {
    // Remove: import Vue from 'vue'
    ast.program.body = ast.program.body.filter(node => {
        return !(t.isImportDeclaration(node) &&
            node.source.value === 'vue' &&
            node.specifiers.length === 1 &&
            node.specifiers[0].local.name === 'Vue');
    });
    // Remove: import { mapActions, mapGetters } from 'vuex';
    ast.program.body = ast.program.body.filter(node => {
        return !(t.isImportDeclaration(node) && node.source.value === 'vuex');
    });
}
function addVuexStoreDeclarations(ast) {
    const vueComponentIndex = ast.program.body.findIndex(node => {
        return t.isExportDefaultDeclaration(node);
    });
    const vueComponent = ast.program.body[vueComponentIndex];
    const classBody = vueComponent.declaration.body;
    const storeNames = classBody.body
        .filter((member) => t.isClassProperty(member))
        .filter(member => member.decorators && member.decorators.length === 1)
        .map(member => member.decorators[0].expression.callee.name)
        .filter(decoratorName => decoratorName.endsWith('Store.Getter') || decoratorName.endsWith('Store.Action'))
        .map(decoratorName => decoratorName.split('.')[0]);
    const uniqueStoreNames = [...new Set(storeNames)].sort();
    const declarations = uniqueStoreNames.map(storeName => {
        const storeObject = lodash_1.upperFirst(storeName).replace(/Store$/, '');
        const rhsArgument = t.memberExpression(t.identifier(storeObject), t.identifier('type'));
        const rhsExpression = t.callExpression(t.identifier('namespace'), [rhsArgument]);
        return t.variableDeclaration('const', [t.variableDeclarator(t.identifier(storeName), rhsExpression)]);
    });
    declarations.reverse().forEach(declaration => {
        ast.program.body.splice(vueComponentIndex, 0, declaration);
    });
    return {
        numberOfDeclarations: declarations.length,
    };
}
function sortVueComponentClassMembers(ast) {
    const vueComponent = ast.program.body.find(node => {
        return t.isExportDefaultDeclaration(node);
    });
    const classBody = vueComponent.declaration.body;
    classBody.body = lodash_1.sortBy(classBody.body, member => {
        const typeProp = ['ClassProperty', 'ClassMethod'].indexOf(member.type);
        const numberOfDecorators = t.isClassProperty(member) && member.decorators ? member.decorators.length : 0;
        return [typeProp, -numberOfDecorators];
    });
}
function postProcessCode(code) {
    code = singleLineForProps(code);
    code = singleLineForGettersAndActions(code);
    code = removeNewlineBetweenBlocksOfSameType(code);
    code = removeNewlinesInClassDecorator(code);
    return code;
}
function singleLineForProps(code) {
    const lines = code.split('\n');
    const resultLines = [];
    const patterns = [/@Prop\(/, /@PropSync\(/];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let lineToPush = line;
        if (patterns.some(pattern => pattern.test(line.trim()))) {
            for (let j = i + 1; j < lines.length; j++) {
                const nextLine = lines[j];
                if (nextLine.trim() === '})') {
                    lineToPush = lineToPush.replace(/,$/, '');
                }
                lineToPush += ` ${nextLine.trim()}`;
                i++;
                if (nextLine.includes(';')) {
                    break;
                }
            }
        }
        resultLines.push(lineToPush);
    }
    return resultLines.join('\n');
}
function singleLineForGettersAndActions(code) {
    const lines = code.split('\n');
    const resultLines = [];
    const patterns = [/^@.*\.Getter\(.*\)$/, /^@.*\.Action\(.*\)$/];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (patterns.some(pattern => pattern.test(line.trim())) && i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            resultLines.push(`${line} ${nextLine.trim()}`);
            i++;
        }
        else {
            resultLines.push(line);
        }
    }
    return resultLines.join('\n');
}
function removeNewlineBetweenBlocksOfSameType(code) {
    const lines = code.split('\n');
    const resultLines = [];
    const patterns = [/@Prop\(/, /@PropSync\(/, /^@.*\.Getter\(.*\)/, /^@.*\.Action\(.*\)/];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        resultLines.push(line);
        if (i + 2 >= lines.length) {
            continue;
        }
        const nextLine = lines[i + 1];
        const matchingPattern = patterns.find(pattern => pattern.test(line.trim()));
        const nextLineIsEmpty = nextLine.trim() === '';
        if (matchingPattern && nextLineIsEmpty && i + 2 < lines.length) {
            const nextNextLine = lines[i + 2];
            if (matchingPattern.test(nextNextLine.trim())) {
                i++;
            }
        }
    }
    return resultLines.join('\n');
}
function removeNewlinesInClassDecorator(code) {
    const lines = code.split('\n');
    const resultLines = [];
    let inDecorator = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '@Component({') {
            inDecorator = true;
        }
        if (inDecorator) {
            if (line.trim() !== '') {
                resultLines.push(line);
            }
        }
        else {
            resultLines.push(line);
        }
        if (line === '})') {
            inDecorator = false;
        }
    }
    return resultLines.join('\n');
}
