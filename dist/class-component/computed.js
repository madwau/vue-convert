"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const t = require("@babel/types");
const utils_1 = require("../nodes/utils");
const asis_1 = require("./asis");
const flatMap = require("lodash.flatmap");
function convertComputed(objectAst) {
    return flatMap(objectAst.properties, p => {
        if (t.isSpreadElement(p))
            return asis_1.convertSpreadVuexHelpers(p, 'computed');
        return computedObjectMemberToClassMember(p);
    });
}
exports.convertComputed = convertComputed;
function computedObjectMemberToClassMember(member) {
    const methods = asis_1.maybeConvertMethod(member, 'get');
    if (methods)
        return methods;
    if (!(t.isObjectProperty(member) && t.isObjectExpression(member.value))) {
        console.warn(`Computed property ${utils_1.literalKey(member.key)} is not an Object.`);
        return [utils_1.todoMethod(member, 'get')];
    }
    return [utils_1.todoMethod(member, 'get', member)];
}
