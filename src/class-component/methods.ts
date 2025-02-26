import * as t from '@babel/types';
import { flatten } from 'lodash';
import { ClassMember, todoMethod } from '../nodes/utils';
import { convertSpreadVuexHelpers, maybeConvertMethod } from './asis';

export function convertMethods(objectAst: t.ObjectExpression): ClassMember[] {
  return flatten(
    objectAst.properties.map(p => {
      if (t.isSpreadElement(p)) return convertSpreadVuexHelpers(p, 'methods');
      const methods = maybeConvertMethod(p);
      if (methods && methods.length === 1) return methods[0];
      console.warn(`Non-function property ${p.type} is found in methods object.`);
      return todoMethod(p, 'method');
    }),
  );
}
