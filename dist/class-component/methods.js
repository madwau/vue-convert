"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const t = require("@babel/types");
const lodash_1 = require("lodash");
const utils_1 = require("../nodes/utils");
const asis_1 = require("./asis");
function convertMethods(objectAst) {
    return lodash_1.flatten(objectAst.properties.map(p => {
        if (t.isSpreadElement(p))
            return asis_1.convertSpreadVuexHelpers(p, 'methods');
        const method = asis_1.maybeConvertMethod(p);
        if (method)
            return method;
        console.warn(`Non-function property ${p.type} is found in methods object.`);
        return utils_1.todoMethod(p, 'method');
    }));
}
exports.convertMethods = convertMethods;
