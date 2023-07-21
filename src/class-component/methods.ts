import * as t from '@babel/types';
import { flatten } from 'lodash';
import { ClassMember, todoMethod } from '../nodes/utils';
import { convertSpreadMethods, maybeConvertMethod } from './asis';

export function convertMethods(objectAst: t.ObjectExpression): ClassMember[] {
  return flatten(
    objectAst.properties.map(p => {
      if (t.isSpreadElement(p)) return convertSpreadMethods(p);
      const method = maybeConvertMethod(p);
      if (method) return method;
      console.warn(`Non-function property ${p.type} is found in methods object.`);
      return todoMethod(p, 'method');
    }),
  );
}
