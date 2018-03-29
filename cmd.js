#!/usr/bin/env node
//@flow
'use strict';

const assert = require('assert');
const fs = require('fs');
const gen = require('./index');


function writeValidatorSrc(srcPath) {
    assert(/\.js$/.test(srcPath));
    let dstPath = srcPath.replace(/\.js$/, '.validator.js');

    let src = gen.makeValidatorSrc(srcPath);
    fs.writeFileSync(dstPath, src);
}

function main() {
    switch (process.argv.length) {
    case 3: {
        let srcPath = process.argv[2];
        return writeValidatorSrc(srcPath);
    }
    default: {
        console.log(`Usage: ${process.argv.slice(0, 2).join(' ')} <path to js>`);
        return process.exit(1);
    }
    }
}
main();
