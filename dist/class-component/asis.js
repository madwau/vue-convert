"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const t = require("@babel/types");
const lodash_1 = require("lodash");
const utils_1 = require("../nodes/utils");
const comments_1 = require("../nodes/comments");
function convertGenericProperty(member) {
    const key = utils_1.literalKey(member.key) || 'TODO_invalidKey';
    const methods = maybeConvertMethod(member);
    if (methods)
        return methods;
    const property = member;
    if (t.isExpression(property.value)) {
        return [comments_1.copyNodeComments(t.classProperty(t.identifier(key), property.value), property)];
    }
    else {
        console.warn(`Invalid object member of ${key}`);
        return [utils_1.todoProperty(property)];
    }
}
exports.convertGenericProperty = convertGenericProperty;
function maybeConvertMethod(member, kind = 'method', baseMember = member) {
    if (t.isObjectMethod(member)) {
        const classMethod = t.classMethod(kind, member.key, member.params, member.body, member.computed);
        classMethod.async = member.async;
        return [comments_1.copyNodeComments(classMethod, member)];
    }
    if (t.isObjectProperty(member) &&
        t.isObjectExpression(member.value) &&
        member.value.properties.length === 2 &&
        t.isObjectMethod(member.value.properties[0]) &&
        t.isObjectMethod(member.value.properties[1]) &&
        member.value.properties.map(p => p.key.name).includes('get') &&
        member.value.properties.map(p => p.key.name).includes('set')) {
        const getter = member.value.properties.find(p => p.key.name === 'get');
        const setter = member.value.properties.find(p => p.key.name === 'set');
        const classMethod = t.classMethod(kind, baseMember.key, getter.params, getter.body, baseMember.computed);
        classMethod.async = getter.async;
        const classMethod2 = t.classMethod('set', baseMember.key, setter.params, setter.body, baseMember.computed);
        classMethod2.async = setter.async;
        return [comments_1.copyNodeComments(classMethod, member), comments_1.copyNodeComments(classMethod2, member)];
    }
    if (t.isFunctionExpression(member.value)) {
        const classMethod = t.classMethod(kind, baseMember.key, member.value.params, member.value.body, baseMember.computed);
        classMethod.async = member.value.async;
        return [comments_1.copyNodeComments(classMethod, member)];
    }
    if (t.isArrowFunctionExpression(member.value)) {
        const arrowFunc = member.value;
        if (utils_1.checkThisUsed(arrowFunc)) {
            console.warn('Found usage of this in arrow function. It cannot be converted.');
            return null;
        }
        // TODO: Maybe use @babel/traverse's path.arrowFunctionToExpression()
        if (t.isBlockStatement(arrowFunc.body)) {
            return [comments_1.copyNodeComments(t.classMethod(kind, baseMember.key, arrowFunc.params, arrowFunc.body), member)];
        }
        const body = t.blockStatement([t.returnStatement(arrowFunc.body)]);
        return [comments_1.copyNodeComments(t.classMethod(kind, baseMember.key, arrowFunc.params, body), member)];
    }
    return null;
}
exports.maybeConvertMethod = maybeConvertMethod;
function convertSpreadVuexHelpers(spread, object_name) {
    if (!t.isCallExpression(spread.argument)) {
        console.warn(`Spread property is found in ${object_name} object. Automatic conversion of object spread is not supported.`);
        return [utils_1.spreadTodoMethod(spread)];
    }
    const callExpression = spread.argument;
    const vuexHelperName = callExpression.callee.name;
    const vuexHelperMap = {
        mapGetters: 'Getter',
        mapActions: 'Action',
    };
    if (vuexHelperName !== 'mapGetters' && vuexHelperName !== 'mapActions') {
        console.warn(`Spread property is found in ${object_name} object. Automatic conversion of object spread is not supported.`);
        return [utils_1.spreadTodoMethod(spread)];
    }
    const namespaceExpression = callExpression.arguments[0];
    const mapExpression = callExpression.arguments[1];
    // Example: { namespace: "Participants", decoratorName: "participantsStore.Action" }
    const namespace = getNamespaceFromNamespaceExpression(namespaceExpression);
    const decoratorName = `${lodash_1.lowerFirst(namespace)}Store.${vuexHelperMap[vuexHelperName]}`;
    if (t.isObjectExpression(mapExpression)) {
        return mapExpression.properties.map(property => {
            const key = property.key.name;
            const propsOptions = property.value;
            const classProperty = comments_1.copyNodeComments(t.classProperty(t.identifier(key)), property);
            classProperty.decorators = [t.decorator(t.callExpression(t.identifier(decoratorName), [propsOptions]))];
            return classProperty;
        });
    }
    else if (t.isArrayExpression(mapExpression)) {
        return mapExpression.elements.map(element => {
            const key = element && t.isStringLiteral(element) ? element.value : 'TODO_unknownKey';
            const propsOptions = element;
            const classProperty = comments_1.copyNodeComments(t.classProperty(t.identifier(key)), element);
            classProperty.decorators = [t.decorator(t.callExpression(t.identifier(decoratorName), [propsOptions]))];
            return classProperty;
        });
    }
    console.warn(`Spread property with unsupported expression found in ${object_name} object. Automatic conversion is not supported.`);
    return [utils_1.spreadTodoMethod(spread)];
}
exports.convertSpreadVuexHelpers = convertSpreadVuexHelpers;
function getNamespaceFromNamespaceExpression(namespaceExpression) {
    if (t.isStringLiteral(namespaceExpression)) {
        return namespaceExpression.value;
    }
    else if (t.isMemberExpression(namespaceExpression)) {
        return namespaceExpression.object.name;
    }
    throw new Error('Invalid namespace expression');
}
