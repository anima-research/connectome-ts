/**
 * Enhanced action parameter parser that supports named parameters
 */

export function parseInlineParameters(paramString: string): Record<string, any> {
  // Handle empty params
  if (!paramString || !paramString.trim()) {
    return {};
  }
  
  const params: Record<string, any> = {};
  
  // Try to parse as named parameters first
  // Pattern: key=value, key="value", key=123, key=true
  const namedParamRegex = /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|true|false|\d+\.?\d*|[^,\s]+)/g;
  const matches = [...paramString.matchAll(namedParamRegex)];
  
  if (matches.length > 0) {
    // We have named parameters
    for (const match of matches) {
      const key = match[1];
      let value: any = match[2];
      
      // Parse the value
      if (value.startsWith('"') && value.endsWith('"')) {
        // String in double quotes
        value = value.slice(1, -1).replace(/\\"/g, '"');
      } else if (value.startsWith("'") && value.endsWith("'")) {
        // String in single quotes
        value = value.slice(1, -1).replace(/\\'/g, "'");
      } else if (value === 'true') {
        value = true;
      } else if (value === 'false') {
        value = false;
      } else if (/^\d+$/.test(value)) {
        value = parseInt(value, 10);
      } else if (/^\d+\.\d+$/.test(value)) {
        value = parseFloat(value);
      }
      // else keep as string
      
      params[key] = value;
    }
  } else {
    // No named parameters found, check for positional
    // Could be: "single value" or value1, value2, value3
    const positionalRegex = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,]+)/g;
    const positionalMatches = [...paramString.matchAll(positionalRegex)];
    
    if (positionalMatches.length === 1) {
      // Single positional parameter
      let value = positionalMatches[0][1].trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\"/g, '"');
      }
      params.value = value;
    } else if (positionalMatches.length > 1) {
      // Multiple positional parameters - store as array
      params.values = positionalMatches.map(m => {
        let val = m[1].trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.slice(1, -1).replace(/\\"/g, '"');
        }
        return val;
      });
    }
  }
  
  return params;
}

// Test cases
if (require.main === module) {
  const testCases = [
    'speed="slowly", careful=true',
    '"gently"',
    'alice, bob, charlie',
    'path="/tmp/test.txt", content="Hello world", append=true',
    '42',
    'x=10, y=20.5, enabled=true, name="test"'
  ];
  
  console.log('Testing enhanced parameter parser:\n');
  testCases.forEach(test => {
    console.log(`Input: ${test}`);
    console.log('Output:', JSON.stringify(parseInlineParameters(test), null, 2));
    console.log();
  });
}
