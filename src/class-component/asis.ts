import * as t from '@babel/types';
import { lowerFirst } from 'lodash';
import { checkThisUsed, ClassMember, literalKey, MethodKind, spreadTodoMethod, todoProperty } from '../nodes/utils';
import { copyNodeComments } from '../nodes/comments';

export function convertGenericProperty(member: t.ObjectMember): ClassMember[] {
  const key = literalKey(member.key) || 'TODO_invalidKey';
  const methods = maybeConvertMethod(member);
  if (methods) return methods;
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
): t.ClassMethod[] | null {
  if (t.isObjectMethod(member)) {
    const classMethod = t.classMethod(kind, member.key, member.params, member.body, member.computed);
    classMethod.async = member.async;
    return [copyNodeComments(classMethod, member)];
  }
  if (
    t.isObjectProperty(member) &&
    t.isObjectExpression(member.value) &&
    member.value.properties.length === 2 &&
    t.isObjectMethod(member.value.properties[0]) &&
    t.isObjectMethod(member.value.properties[1]) &&
    member.value.properties.map(p => (p as t.ObjectMethod).key.name).includes('get') &&
    member.value.properties.map(p => (p as t.ObjectMethod).key.name).includes('set')
  ) {
    const getter = member.value.properties.find(p => (p as t.ObjectMethod).key.name === 'get') as t.ObjectMethod;
    const setter = member.value.properties.find(p => (p as t.ObjectMethod).key.name === 'set') as t.ObjectMethod;
    const classMethod = t.classMethod(kind, baseMember.key, getter.params, getter.body, baseMember.computed);
    classMethod.async = getter.async;
    const classMethod2 = t.classMethod('set', baseMember.key, setter.params, setter.body, baseMember.computed);
    classMethod2.async = setter.async;
    return [copyNodeComments(classMethod, member), copyNodeComments(classMethod2, member)];
  }
  if (t.isFunctionExpression(member.value)) {
    const classMethod = t.classMethod(
      kind,
      baseMember.key,
      member.value.params,
      member.value.body,
      baseMember.computed,
    );
    classMethod.async = member.value.async;
    return [copyNodeComments(classMethod, member)];
  }
  if (t.isArrowFunctionExpression(member.value)) {
    const arrowFunc = member.value;
    if (checkThisUsed(arrowFunc)) {
      console.warn('Found usage of this in arrow function. It cannot be converted.');
      return null;
    }
    // TODO: Maybe use @babel/traverse's path.arrowFunctionToExpression()
    if (t.isBlockStatement(arrowFunc.body)) {
      return [copyNodeComments(t.classMethod(kind, baseMember.key, arrowFunc.params, arrowFunc.body), member)];
    }
    const body = t.blockStatement([t.returnStatement(arrowFunc.body)]);
    return [copyNodeComments(t.classMethod(kind, baseMember.key, arrowFunc.params, body), member)];
  }
  return null;
}

export function convertSpreadVuexHelpers(spread: t.SpreadElement, object_name: string): ClassMember[] {
  if (!t.isCallExpression(spread.argument)) {
    console.warn(
      `Spread property is found in ${object_name} object. Automatic conversion of object spread is not supported.`,
    );
    return [spreadTodoMethod(spread)];
  }

  const callExpression = spread.argument;
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
  const namespace = getNamespaceFromNamespaceExpression(namespaceExpression);
  const decoratorName = `${lowerFirst(namespace)}Store.${vuexHelperMap[vuexHelperName]}`;

  if (t.isObjectExpression(mapExpression)) {
    return mapExpression.properties.map(property => {
      const key = ((property as t.ObjectProperty).key as t.Identifier).name;
      const propsOptions = (property as t.ObjectProperty).value as t.Expression;
      const classProperty = copyNodeComments(t.classProperty(t.identifier(key)), property);
      classProperty.decorators = [t.decorator(t.callExpression(t.identifier(decoratorName), [propsOptions]))];
      return classProperty;
    });
  } else if (t.isArrayExpression(mapExpression)) {
    return mapExpression.elements.map(element => {
      const key = 'TODO_unknownKey';
      const propsOptions = element as t.Expression;
      const classProperty = copyNodeComments(t.classProperty(t.identifier(key)), element as t.BaseNode);
      classProperty.decorators = [t.decorator(t.callExpression(t.identifier(decoratorName), [propsOptions]))];
      return classProperty;
    });
  }

  console.warn(
    `Spread property with unsupported expression found in ${object_name} object. Automatic conversion is not supported.`,
  );
  return [spreadTodoMethod(spread)];
}

function getNamespaceFromNamespaceExpression(namespaceExpression: t.CallExpression['arguments'][0]): string {
  if (t.isStringLiteral(namespaceExpression)) {
    return namespaceExpression.value;
  } else if (t.isMemberExpression(namespaceExpression)) {
    return (namespaceExpression.object as t.Identifier).name;
  }
  throw new Error('Invalid namespace expression');
}
