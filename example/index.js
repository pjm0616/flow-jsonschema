//@flow
'use strict';

/*::
import type {A, B} from './types';
*/
const validator = require('./types.validator');


let a/*: A*/ = {
    num: 1234,
    str: 'abcd',
    bool: true,

    numLit: 20,
    strLit: 'bc',

    numNull: null,
};

let b/*: B*/ = {
    arr: [a, a],
    tuple: ['a', 2, 2],
    c: 33,
    d: null,
    e: {
        a: 1,
        b: '3',
    },
};

// b2.tuple[3] is invalid
let b2/*: Object*/ = {
    arr: [a, a],
    tuple: ['a', 2, null],
    c: 33,
    d: null,
    e: {
        a: 1,
        b: '3',
    },
};

// b3.e.b is invalid
let b3/*: Object*/ = {
    arr: [a, a],
    tuple: ['a', 2, 2],
    c: 33,
    d: null,
    e: {
        a: 2,
        b: '3',
    },
};

console.log(validator.checkB(b) != null); // ok
console.log(validator.checkB(b2) != null); // error
console.log(validator.checkB(b3) != null); // error