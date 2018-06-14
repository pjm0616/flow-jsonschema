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
    case 'VoidTypeAnnotation':
        throw new UnsupportedTypeError('undefined types not supported');

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
        if (desc.callProperties.length !== 0) {
            throw new UnsupportedTypeError('call properties not supported');
        }
        if (desc.indexers.length !== 0) {
            if (desc.properties.length > 0) {
                throw new UnsupportedTypeError('objects with both static properties and indexed properties are not supported');
            }
            // TODO: keyType validation is not supported yet.
            //let keyType = parseDesc(desc.indexers[0].key);
            let valueType = parseDesc(desc.indexers[0].value);
            return {
                type: 'object',
                patternProperties: {
                    '.*': valueType,
                },
                additionalProperties: false,
            };
        }
        let res = {
            type: 'object',
            properties: {},
            required: [],
        };
        for (let prop of desc.properties) {
            assert(prop.type === 'ObjectTypeProperty');
            assert(prop.kind === 'init');
            assert(prop.key.type === 'Identifier');
            let key = prop.key.name;
            let value = parseDesc(prop.value);
            res.properties[key] = value;
            if (prop.optional !== true) {
                res.required.push(key);
            }
        }
        res.required.sort();
        return res;

    case 'TupleTypeAnnotation':
        return {
            type: 'array',
            items: desc.types.map(parseDesc),
        };

    case 'GenericTypeAnnotation':
        assert(desc.id.type === 'Identifier');
        let name = desc.id.name;
        if (name === 'Array') {
            assert(desc.typeParameters.type === 'TypeParameterInstantiation');
            assert(desc.typeParameters.params.length === 1);
            let res = parseDesc(desc.typeParameters.params[0]);
            return {
                type: 'array',
                items: res,
            };
        } else if (name === '$Exact') {
            assert(desc.typeParameters.type === 'TypeParameterInstantiation');
            assert(desc.typeParameters.params.length === 1);
            let res = parseDesc(desc.typeParameters.params[0]);
            return res;
        } else {
            throw new UnsupportedTypeError('unsupported type: ' + name);
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
    let jsonSchema = {};
    let flowSource = {};

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
                    jsonSchema[name] = schema;
                    flowSource[name] = typedefsrc.slice(child.range[0], child.range[1]);
                } catch (exc) {
                    if (exc instanceof UnsupportedTypeError) {
                        console.warn('Skipping type ' + name + ': ' + exc.message);
                    } else {
                        throw exc;
                    }
                }
            }
        }
    }

    return [jsonSchema, flowSource];
}


function makeValidatorSrc(srcPath) {
    let [types, srcs] = makeSchema(srcPath);
    let typeNames = Object.keys(types).sort();
    if (typeNames.length === 0) {
        throw new Error('no types to process');
    }

    let concatFlowDefsSrc = typeNames.map(name => srcs[name]).join('\n');

    let src = [];
    src.push(`//@flow
'use strict';
// Generated by flow-jsonschema from ${srcPath}.
// DO NOT EDIT.

const assert = require('assert');
const Ajv = require('ajv');
const ajv = new Ajv();

/*::
${concatFlowDefsSrc}

export type ValidationErrorDesc = {|
    keyword: string,
    dataPath: string,
    schemaPath: string,
    params: Object,
    message: string,
|};
*/

let g_validators = {};
`);

    for (let name of typeNames) {
        let nameJson = JSON.stringify(name);
        let schemaJson = JSON.stringify(types[name], null, 4);
        let checkFuncName = 'check' + name;
        src.push(`// Checks whether \`val\` is a valid ${name}.
function ${checkFuncName}(val/*: ${name}*/)/*: boolean*/ {
    let validator = g_validators[${nameJson}];
    if (validator == null) {
        let schema = ${schemaJson.split('\n').map(line => '        ' + line).join('\n').slice(8)};
        validator = ajv.compile(schema);
        g_validators[${nameJson}] = validator;
    }
    let ret/*: boolean*/ = validator(val);
    assert(typeof ret === 'boolean');
    let errors/*: ?Array<ValidationErrorDesc>*/ = (validator/*: any*/).errors;
    (${checkFuncName}/*: any*/).errors = errors;
    return ret;
};
`);
    }

    src.push('module.exports = {');
    for (let name of typeNames) {
        src.push(`    ${'check' + name},`);
    }
    src.push('};');

    return src.join('\n');
}


module.exports = {
    makeSchema,
    makeValidatorSrc,
};
