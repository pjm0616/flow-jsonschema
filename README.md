flow-jsonschema converts flow type declarations to JSON schema.

See the examples directory for examples.

## Usage
flow-jsonschema generates validators for all exported JSON compatible types in the given file.

Add the generate command to package.json's "scripts" section.
If you want to commit the generated file:
```
"generate": "./node_modules/.bin/flow-jsonschema ./types.js ./types.validator.js",
```
Or, if you want to generate the file on install:
```
"install": "./node_modules/.bin/flow-jsonschema ./types.js ./types.validator.js",
```

## Generating validators only for specific types
If you don't want to generate validators for every types in the file, create a file that forwards selected types and run flow-jsonschema on that file.
```typescript
//@flow
export type {TypeA, TypeB} from './types';
```
