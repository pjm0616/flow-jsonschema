'use strict';

const assert = require('assert');
const fs = require('fs');
const child_process = require('child_process');
const flowParser = require('flow-parser');


class UnsupportedTypeError extends Error {
}

function parseLiteral(desc) {
    switch (desc.type) {
    case 'StringLiteralTypeAnnotation':
    case 'NumberLiteralTypeAnnotation':
    case 'BooleanLiteralTypeAnnotation':
        return desc.value;

    default:
        throw new Error('unsupported type ' + desc.type);
    }
}

function parseDesc(desc) {
    switch (desc.type) {
    case 'StringLiteralTypeAnnotation':
        return {
            type: 'string',
            enum: [parseLiteral(desc)],
        };
    case 'NumberLiteralTypeAnnotation':
        return {
            type: 'number',
            enum: [parseLiteral(desc)],
        };
    case 'BooleanLiteralTypeAnnotation':
        return {
            type: 'boolean',
            enum: [parseLiteral(desc)],
        };
    case 'NullLiteralTypeAnnotation':
        return {
            type: 'null',
        };

    case 'StringTypeAnnotation':
        return {
            type: 'string',
        };
    case 'NumberTypeAnnotation':
        return {
            type: 'number',
        };
    case 'BooleanTypeAnnotation':
        return {
            type: 'boolean',
        };
    case 'VoidTypeAnnotation': // undefined
        throw new UnsupportedTypeError('undefined types are not supported');
        /*
        return {
            type: 'null', // there is no undefined type in jsonschema.
        };
        */

    case 'NullableTypeAnnotation':
        return {
            anyOf: [
                {
                    type: 'null',
                },
                parseDesc(desc.typeAnnotation),
            ],
        };

    case 'ObjectTypeAnnotation':
        if (desc.indexers.length !== 0) {
            throw new UnsupportedTypeError('indexers not supported');
        }
        if (desc.callProperties.length !== 0) {
            throw new UnsupportedTypeError("call properties not supported");
        }
        let res = {
            type: 'object',
            properties: {},
        };
        for (let prop of desc.properties) {
            assert(prop.type === 'ObjectTypeProperty');
            assert(prop.kind === 'init');
            assert(prop.key.type === 'Identifier');
            let key = prop.key.name;
            let value = parseDesc(prop.value);
            res.properties[key] = value;
        }
        if (desc.exact) {
            res.required = Object.keys(res.properties);
        }
        return res;

    case 'GenericTypeAnnotation':
        assert(desc.id.type === 'Identifier');
        assert(desc.typeParameters.type === 'TypeParameterInstantiation');
        let name = desc.id.name;
        let params = desc.typeParameters.params.map(parseDesc);
        if (name === 'Array') {
            return {
                type: 'array',
                items: params,
            };
        } else if (name === '$Exact') {
            assert(params.length === 1);
            let res = params[0];
            res.required = Object.keys(res.properties);
            return res;
        } else {
            throw new Error('unsupported type ' + name);
        }

    case 'UnionTypeAnnotation':
        let types = desc.types.map(parseDesc);
        return {
            anyOf: types,
        };

    default:
        throw new Error('unknown type ' + desc.type);
    }
}

function makeSchema(path) {
    let result = {};
    let typedefsrc = child_process.execFileSync('flow', ['gen-flow-files', '--quiet', path], {encoding: 'utf-8'});
    let ast = flowParser.parse(typedefsrc);
    assert(ast.type === 'Program');
    for (let child of ast.body) {
        if (child.type === 'ExportNamedDeclaration' && child.exportKind === 'type') {
            let decl = child.declaration;
            if (decl.type === 'TypeAlias' && decl.id.type === 'Identifier') {
                let name = decl.id.name;
                let desc = decl.right;
                try {
                    let schema = parseDesc(desc);
                    result[name] = schema;
                } catch (exc) {
                    if (exc instanceof UnsupportedTypeError) {
                    } else {
                        throw exc;
                    }
                }
            }
        }
    }
    return result;
}


function makeValidatorSrc(srcPath, importName) {
    let types = makeSchema(srcPath);
    let typeNames = Object.keys(types);
    if (typeNames.length === 0) {
        throw new Error('no types to process');
    }

    let src = [];
    src.push(`//@flow
'use strict';

const assert = require('assert');
const Ajv = require('ajv');
const ajv = new Ajv();

/*::
import type {
${typeNames.map(s => '    ' + s).join(',\n')}
} from ${JSON.stringify(importName)};
*/

let g_validators = {};
`);

    for (let name of typeNames) {
        let funcName = 'check' + name;
        let nameJson = JSON.stringify(name);
        let schemaJson = JSON.stringify(types[name], null, 4);
        src.push(`// Checks whether \`val\` is a valid ${name}.
// @returns \`val\` as is if it's a valid ${name}, null if \`val\` is not valid.
module.exports[${JSON.stringify(funcName)}] = function ${funcName}(val/*: ${name}*/)/*: null | ${name}*/ {
    let validator = g_validators[${nameJson}];
    if (validator == null) {
        let schema = ${schemaJson.split('\n').map(line => '        ' + line).join('\n').slice(8)};
        validator = ajv.compile(schema);
        g_validators[${nameJson}] = validator;
    }
    let ret = validator(val);
    assert(typeof ret === 'boolean');
    if (ret) {
        return val;
    } else {
        return null;
    }
};
`);
    }

    return src.join('\n');
}


module.exports = {
    makeSchema,
    makeValidatorSrc,
};
