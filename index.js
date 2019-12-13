'use strict';

const assert = require('assert');
const fs = require('fs');
const child_process = require('child_process');
const semver = require('semver');
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
        if (desc.exact) {
            res.additionalProperties = false;
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
            if (res.type === 'object') {
                res.additionalProperties = false;
            }
            return res;
        } else {
            throw new UnsupportedTypeError('unsupported type: ' + name);
        }

    case 'UnionTypeAnnotation':
        let types = desc.types.map(parseDesc);
        return {
            anyOf: types,
        };

    case 'AnyTypeAnnotation':
        return {};

    default:
        throw new Error('unknown type ' + desc.type);
    }
}

// For flow <0.88
function makeSchemaFlow88(path) {
    let jsonSchema = {};
    let flowSource = {};

    let typedefsrc = child_process.execFileSync('flow', ['gen-flow-files', '--quiet', path], {encoding: 'utf-8'});
    let ast = flowParser.parse(typedefsrc);
    assert(ast.type === 'Program');
    if (ast.errors.length !== 0) {
        throw new Error(`failed to parse type at ${path} ${line}:${col}: ${JSON.stringify(ast.errors)}`);
    }

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

// Returns flow type definition at the given position.
function flowTypeAtPos(path, line, col) {
    let output = child_process.execFileSync('flow', ['type-at-pos', '--quiet', '--json', '--expand-type-aliases', path, line, col], {encoding: 'utf-8'});
    let src = JSON.parse(output).type;
    let ast = flowParser.parse(src);
    assert(ast.type === 'Program');
    if (ast.errors.length !== 0) {
        throw new Error(`failed to parse type at ${path} ${line}:${col}: ${JSON.stringify(ast.errors)}`);
    }

    assert(ast.body.length === 1);
    const t = ast.body[0];
    assert(t.type === 'TypeAlias');
    const typeDefnSrc = src.slice(t.right.range[0], t.right.range[1]);
    return {
        src: typeDefnSrc,
        ast: t.right,
    };
}

// For flow >=0.89
function makeSchemaFlow89(path) {
    let jsonSchema = {};
    let flowSource = {};

    let typedefsrc = fs.readFileSync(path, 'utf-8');
    let ast = flowParser.parse(typedefsrc);
    assert(ast.type === 'Program');
    if (ast.errors.length !== 0) {
        throw new Error(`failed to parse type at ${path} ${line}:${col}: ${JSON.stringify(ast.errors)}`);
    }

    let localTypes = {};
    for (let child of ast.body) {
        if (child.type === 'ImportDeclaration' && child.importKind === 'type') {
            let specifiers = child.specifiers;
            for (let specifier of specifiers) {
                if (specifier.type !== 'ImportSpecifier') {
                    continue;
                }
                assert(specifier.imported.type === 'Identifier');
                assert(specifier.local.type === 'Identifier');
                localTypes[specifier.local.name] = {
                    defnLoc: specifier.imported.loc,
                };
            }
        } else if (child.type === 'TypeAlias') {
            localTypes[child.id.name] = {
                defnLoc: child.id.loc,
            };
        }
    }

    for (let child of ast.body) {
        if (child.type === 'ExportNamedDeclaration' && child.exportKind === 'type') {
            let decl = child.declaration;
            if (decl != null && decl.type === 'TypeAlias' && decl.id.type === 'Identifier') {
                let name = decl.id.name;
                const res = flowTypeAtPos(path, decl.id.loc.start.line, decl.id.loc.start.column + 1);
                const desc = res.ast;
                try {
                    let schema = parseDesc(desc);
                    jsonSchema[name] = schema;
                    flowSource[name] = `export type ${name} = ${res.src};`;
                } catch (exc) {
                    if (exc instanceof UnsupportedTypeError) {
                        console.warn('Skipping type ' + name + ': ' + exc.message);
                    } else {
                        throw exc;
                    }
                }
            }

            for (let specifier of child.specifiers) {
                if (specifier.type !== 'ExportSpecifier') {
                    continue;
                }
                assert(specifier.exported.type === 'Identifier');
                const name = specifier.exported.name;
                const importInfo = localTypes[specifier.local.name];
                if (importInfo == null) {
                    console.warn('Skipping type ' + name + ': not a type export');
                    continue;
                }
                const res = flowTypeAtPos(path, importInfo.defnLoc.start.line, importInfo.defnLoc.start.column + 1);
                const desc = res.ast;
                try {
                    let schema = parseDesc(desc);
                    jsonSchema[name] = schema;
                    flowSource[name] = `export type ${name} = ${res.src};`;
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

function makeSchema(path) {
    let output = child_process.execFileSync('flow', ['version', '--', '--json'], {encoding: 'utf-8'});
    let ver = JSON.parse(output).semver;
    if (semver.lt(ver, '0.89.0')) {
        return makeSchemaFlow88(path);
    }
    return makeSchemaFlow89(path);
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
/* eslint-disable */
// Generated by flow-jsonschema from ${srcPath}.
// DO NOT EDIT.

const assert = require('assert');
const Ajv = require('ajv');
const ajvDefault = new Ajv();
const ajvAllErrors = new Ajv({allErrors: true});

/*::
${concatFlowDefsSrc}

type ValidationOptions = {
    allErrors?: boolean,
};
export type ValidationErrorDesc = {|
    keyword: string,
    dataPath: string,
    schemaPath: string,
    params: Object,
    message: string,
|};
*/

class ValidationError extends Error {
    /*::
    typeName: string;
    errors: ValidationErrorDesc[];
    */
    constructor(typeName/*: string*/, errors/*: ValidationErrorDesc[]*/) {
        let msg/*: string*/;
        if (errors.length > 0) {
            const err = errors[0];
            msg = typeName + err.dataPath + ': ' + err.message;
            if (err.params.additionalProperty) {
                msg += ': ' + JSON.stringify(err.params.additionalProperty);
            }
        } else {
            msg = '(no errors)';
        }
        super(msg);
        this.typeName = typeName;
        this.errors = errors;
    }
}

let g_validators = {};
let g_validatorsAllErrors = {};
`);

    for (let name of typeNames) {
        let nameJson = JSON.stringify(name);
        let schemaJson = JSON.stringify(types[name], null, 4);
        let checkFuncName = 'check' + name;
        let assertFuncName = 'assert' + name;
        src.push(`// Checks whether \`val\` is a valid ${name}.
function ${checkFuncName}(val/*: ${name}*/, opts/*: ValidationOptions*/={})/*: boolean*/ {
    const ajv = opts.allErrors !== true ? ajvDefault : ajvAllErrors;
    const validators = opts.allErrors !== true ? g_validators : g_validatorsAllErrors;

    let validator = validators[${nameJson}];
    if (validator == null) {
        let schema = ${schemaJson.split('\n').map(line => '        ' + line).join('\n').slice(8)};
        validator = ajv.compile(schema);
        validators[${nameJson}] = validator;
    }
    let ret/*: boolean*/ = validator(val);
    assert(typeof ret === 'boolean');
    let errors/*: ?Array<ValidationErrorDesc>*/ = (validator/*: any*/).errors;
    (${checkFuncName}/*: any*/).errors = errors;
    return ret;
};

// Checks whether \`val\` is a valid ${name}.
// @returns \`val\` as is if it's a valid ${name}, throws if not.
function ${assertFuncName}(val/*: ${name}*/, opts/*: ValidationOptions*/={})/*: ${name}*/ {
    let ret = ${checkFuncName}(val, opts);
    assert(typeof ret === 'boolean');
    if (ret) {
        return val;
    } else {
        let errors/*: ?Array<ValidationErrorDesc>*/ = (${checkFuncName}/*: any*/).errors;
        if (errors == null || errors.length === 0) {
            throw new Error('json validation failed');
        }
        throw new ValidationError(${nameJson}, errors);
    }
};
`);
    }

    src.push('module.exports = {');
    src.push('    ValidationError,');
    for (let name of typeNames) {
        src.push(`    ${'check' + name},`);
        src.push(`    ${'assert' + name},`);
    }
    src.push('};');

    return src.join('\n');
}


module.exports = {
    makeSchema,
    makeValidatorSrc,
};
