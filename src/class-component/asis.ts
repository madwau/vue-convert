import * as t from '@babel/types';
import { lowerFirst } from 'lodash';
import { checkThisUsed, ClassMember, literalKey, MethodKind, spreadTodoMethod, todoProperty } from '../nodes/utils';
import { copyNodeComments } from '../nodes/comments';

export function convertGenericProperty(member: t.ObjectMember): ClassMember[] {
  const key = literalKey(member.key) || 'TODO_invalidKey';
  const method = maybeConvertMethod(member);
  if (method) return [method];
  const property = member as t.ObjectProperty;
  if (t.isExpression(property.value)) {
    return [copyNodeComments(t.classProperty(t.identifier(key), property.value as t.Expression), property)];
  } else {
    console.warn(`Invalid object member of ${key}`);
    return [todoProperty(property)];
  }
}

export function maybeConvertMethod(
  member: t.ObjectMember,
  kind: MethodKind = 'method',
  baseMember: t.ObjectMember = member,
): t.ClassMethod | null {
  if (t.isObjectMethod(member)) {
    return copyNodeComments(
      t.classMethod(kind, baseMember.key, member.params, member.body, baseMember.computed),
      member,
    );
  }
  if (t.isFunctionExpression(member.value)) {
    return copyNodeComments(
      t.classMethod(kind, baseMember.key, member.value.params, member.value.body, baseMember.computed),
      member,
    );
  }
  if (t.isArrowFunctionExpression(member.value)) {
    const arrowFunc = member.value;
    if (checkThisUsed(arrowFunc)) {
      console.warn('Found usage of this in arrow function. It cannot be converted.');
      return null;
    }
    // TODO: Maybe use @babel/traverse's path.arrowFunctionToExpression()
    if (t.isBlockStatement(arrowFunc.body)) {
      return copyNodeComments(t.classMethod(kind, baseMember.key, arrowFunc.params, arrowFunc.body), member);
    }
    const body = t.blockStatement([t.returnStatement(arrowFunc.body)]);
    return copyNodeComments(t.classMethod(kind, baseMember.key, arrowFunc.params, body), member);
  }
  return null;
}

export function convertSpreadVuexHelpers(spread: t.SpreadElement, object_name: string): ClassMember[] {
  const callExpression = spread.argument as t.CallExpression;
  const vuexHelperName = (callExpression.callee as t.Identifier).name;

  const vuexHelperMap = {
    mapGetters: 'Getter',
    mapActions: 'Action',
  };

  if (vuexHelperName !== 'mapGetters' && vuexHelperName !== 'mapActions') {
    console.warn(
      `Spread property is found in ${object_name} object. Automatic conversion of object spread is not supported.`,
    );
    return [spreadTodoMethod(spread)];
  }

  const namespaceExpression = callExpression.arguments[0] as t.MemberExpression;
  const mapExpression = callExpression.arguments[1];

  // Example: { namespace: "Participants", decoratorName: "participantsStore.Action" }
  const namespace = (namespaceExpression.object as t.Identifier).name;
  const decoratorName = `${lowerFirst(namespace)}Store.${vuexHelperMap[vuexHelperName]}`;

  if (!t.isObjectExpression(mapExpression)) {
    console.warn(
      `Spread property with array expression found in ${object_name} object. Automatic conversion is not supported.`,
    );
    return [spreadTodoMethod(spread)];
  }

  return mapExpression.properties.map(property => {
    const key = ((property as t.ObjectProperty).key as t.Identifier).name;
    const propsOptions = (property as t.ObjectProperty).value as t.Expression;
    const classProperty = copyNodeComments(t.classProperty(t.identifier(key)), property);
    classProperty.decorators = [t.decorator(t.callExpression(t.identifier(decoratorName), [propsOptions]))];
    return classProperty;
  });
}
