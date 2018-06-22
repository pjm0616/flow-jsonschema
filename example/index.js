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
    f: {
        'x': 3,
        'y': 'z',
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
    f: {
        'x': 3,
        'y': 'z',
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
    f: {
        'x': 3,
        'y': 'z',
    },
};

// b4.f.x is invalid
let b4/*: Object*/ = {
    arr: [a, a],
    tuple: ['a', 2, 2],
    c: 33,
    d: null,
    e: {
        a: 1,
        b: '3',
    },
    f: {
        'x': true,
        'y': 'z',
    },
};

// has an additional property b5.zz.
// b5.tuple[0] is invalid
let b5/*: Object*/ = {
    arr: [a, a],
    tuple: [null, 2, 2],
    c: 33,
    d: null,
    e: {
        a: 1,
        b: '3',
    },
    f: {
        'x': 3,
        'y': 'z',
    },
    zz: 2,
};

console.log(validator.checkB(b)); // ok
console.log(validator.checkB(b2)); // error
console.log(validator.checkB(b3)); // error
console.log(validator.checkB(b4)); // error
console.log(validator.checkB(b5)); // error
try {
    validator.assertB(b5, {allErrors: true}); // throws
} catch (err) {
    console.log(err);
}
