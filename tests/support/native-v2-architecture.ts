import { readdirSync, readFileSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import * as ts from 'typescript';

export interface NativeRuntimeSource {
  path: string;
  source: string;
}

const RUNTIME_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const FORBIDDEN_WEB_RUNTIME = [
  { name: 'react-native-webview package', pattern: /react-native-webview/i },
  { name: 'WebView component', pattern: /<\s*WebView\b|\bReactNativeWebView\b/i },
  { name: 'WKWebView runtime', pattern: /\bWKWebView\b/ },
  { name: 'injected JavaScript bridge', pattern: /\binjectedJavaScript\b/i },
  { name: 'browser DOM global', pattern: /\b(?:document|window)\s*(?:\.|\[)/i },
  {
    name: 'iframe runtime',
    pattern: /<\s*iframe\b|\bHTMLIFrameElement\b|\bcreateElement\s*\(\s*['"]iframe['"]/i,
  },
] as const;

export function readNativeRuntimeSources(projectRoot: string): NativeRuntimeSource[] {
  const entryFiles = ['App.tsx', 'index.ts'].map((path) => resolve(projectRoot, path));
  const sourceFiles = readRuntimeDirectory(resolve(projectRoot, 'src'));

  return [...entryFiles, ...sourceFiles]
    .sort((left, right) => left.localeCompare(right))
    .map((absolutePath) => ({
      path: relative(projectRoot, absolutePath).replaceAll('\\', '/'),
      source: readFileSync(absolutePath, 'utf8'),
    }));
}

export function assertNoWebRuntime(sources: readonly NativeRuntimeSource[]): void {
  for (const { path, source } of sources) {
    for (const marker of FORBIDDEN_WEB_RUNTIME) {
      if (marker.pattern.test(source)) {
        throw new Error(`Forbidden web runtime (${marker.name}) in ${path}`);
      }
    }
  }
}

export function assertReactNativeEntry(source: string): void {
  const sourceFile = ts.createSourceFile(
    'index.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const importsGestureHandler = sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.moduleSpecifier.text === 'react-native-gesture-handler',
  );
  const registersApp = sourceFile.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement)
      && ts.isCallExpression(statement.expression)
      && statement.expression.expression.getText() === 'registerRootComponent'
      && statement.expression.arguments[0]?.getText() === 'App',
  );

  if (!importsGestureHandler || !registersApp) {
    throw new Error('React Native entry violation: initialize gestures and register App');
  }
}

export function assertHybridRootComposition(source: string): void {
  const sourceFile = ts.createSourceFile(
    'App.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const appFunction = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'App' &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword),
  );
  const compositionStatements = sourceFile.statements.filter(
    (statement) => !ts.isImportDeclaration(statement),
  );

  if (!appFunction || compositionStatements.length !== 1 || compositionStatements[0] !== appFunction) {
    rootCompositionError('App.tsx must contain only imports and the default App function');
  }
  if (!appFunction.body || appFunction.body.statements.length !== 1) {
    rootCompositionError('App must contain exactly one return statement');
  }

  const returnStatement = appFunction.body.statements[0];
  if (!ts.isReturnStatement(returnStatement) || !returnStatement.expression) {
    rootCompositionError('App must directly return the native provider tree');
  }

  const root = unwrapParentheses(returnStatement.expression);
  const safeAreaProvider = onlyJsxElementChild(root, 'GestureHandlerRootView');
  const app = onlyJsxChild(safeAreaProvider, 'SafeAreaProvider');
  if (!ts.isJsxSelfClosingElement(app) || app.tagName.getText() !== 'HermesNativeApp') {
    rootCompositionError('SafeAreaProvider must contain only HermesNativeApp');
  }
}

function readRuntimeDirectory(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) return readRuntimeDirectory(absolutePath);
    if (entry.isFile() && RUNTIME_EXTENSIONS.has(extname(entry.name))) return [absolutePath];
    return [];
  });
}

function hasModifier(node: ts.FunctionDeclaration, kind: ts.SyntaxKind): boolean {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function onlyJsxElementChild(expression: ts.Expression, tagName: string): ts.JsxElement {
  if (!ts.isJsxElement(expression) || expression.openingElement.tagName.getText() !== tagName) {
    rootCompositionError(`native root must be ${tagName}`);
  }

  const child = onlyMeaningfulChild(expression);
  if (!ts.isJsxElement(child)) {
    rootCompositionError(`${tagName} must contain exactly one JSX element`);
  }
  return child;
}

function onlyJsxChild(element: ts.JsxElement, tagName: string): ts.JsxChild {
  if (element.openingElement.tagName.getText() !== tagName) {
    rootCompositionError(`expected ${tagName}`);
  }
  return onlyMeaningfulChild(element);
}

function onlyMeaningfulChild(element: ts.JsxElement): ts.JsxChild {
  const children = element.children.filter(
    (child) => !ts.isJsxText(child) || child.getText().trim().length > 0,
  );
  if (children.length !== 1) {
    rootCompositionError(`${element.openingElement.tagName.getText()} must have one child`);
  }
  return children[0];
}

function rootCompositionError(detail: string): never {
  throw new Error(`Hybrid root composition violation: ${detail}`);
}
