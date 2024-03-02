import * as t from '@babel/types';
import { ClassMember, literalKey, todoMethod } from '../nodes/utils';
import { convertSpreadVuexHelpers, maybeConvertMethod } from './asis';
import flatMap = require('lodash.flatmap');

export function convertComputed(objectAst: t.ObjectExpression): ClassMember[] {
  return flatMap(objectAst.properties, p => {
    if (t.isSpreadElement(p)) return convertSpreadVuexHelpers(p, 'computed');
    return computedObjectMemberToClassMember(p);
  });
}

function computedObjectMemberToClassMember(member: t.ObjectMember): t.ClassMethod[] {
  const methods = maybeConvertMethod(member, 'get');
  if (methods) return methods;

  if (!(t.isObjectProperty(member) && t.isObjectExpression(member.value))) {
    console.warn(`Computed property ${literalKey(member.key)} is not an Object.`);
    return [todoMethod(member, 'get')];
  }

  return [todoMethod(member, 'get', member)];
}
