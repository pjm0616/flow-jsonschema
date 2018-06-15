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

    let origSrc/*: ?string*/;
    if (fs.existsSync(dstPath)) {
        // Temporarily remove the flow mark so that the gen-flow-files command does not complain
        // about temporary type errors, since they will go away once flow-jsonschema regenerates the file.
        origSrc = fs.readFileSync(dstPath, 'utf-8');
        const flowMark = '//@flow';
        if (origSrc.slice(0, flowMark.length) === flowMark) {
            let tempSrc = origSrc.slice(flowMark.length);
            fs.writeFileSync(dstPath, tempSrc);
        }
    }

    let err/*: ?Error*/;
    let newSrc/*: ?string*/;
    try {
        newSrc = gen.makeValidatorSrc(srcPath);
    } catch (err_) {
        err = err_;
    }
    if (err == null && newSrc != null) {
        fs.writeFileSync(dstPath, newSrc);
    } else if (err != null) {
        if (origSrc != null) {
            // Restore the original source if there was an error and flow mark was stripped earlier.
            fs.writeFileSync(dstPath, origSrc);
        }
        throw err;
    } else {
        throw new Error();
    }
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
