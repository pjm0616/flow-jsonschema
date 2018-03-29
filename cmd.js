#!/usr/bin/env node
//@flow
'use strict';

const assert = require('assert');
const fs = require('fs');
const gen = require('./index');


function writeValidatorSrc(srcPath/*: string*/, dstPath/*: ?string*/=null) {
    if (dstPath == null) {
        assert(/\.js$/.test(srcPath));
        dstPath = srcPath.replace(/\.js$/, '.validator.js');
    }

    let src = gen.makeValidatorSrc(srcPath);
    fs.writeFileSync(dstPath, src);
}

function main() {
    switch (process.argv.length) {
    case 3: {
        let srcPath = process.argv[2];
        return writeValidatorSrc(srcPath);
    }
    case 4: {
        let srcPath = process.argv[2];
        let dstPath = process.argv[3];
        return writeValidatorSrc(srcPath, dstPath);
    }
    default: {
        console.log(`Usage: ${process.argv.slice(0, 2).join(' ')} <input path>`);
        console.log(`Usage: ${process.argv.slice(0, 2).join(' ')} <input path> <output path>`);
        return process.exit(1);
    }
    }
}
main();
