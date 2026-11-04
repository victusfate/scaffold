// Extract real import edges using the TypeScript parser, never source-text regexes.
import type ts from 'typescript';

export interface ImportEdge { specifier: string | null; line: number; overridden: boolean; typeOnly: boolean }

function isLoaderCall(compiler: typeof ts, expr: ts.Expression): boolean {
  return expr.kind === compiler.SyntaxKind.ImportKeyword
    || (compiler.isIdentifier(expr) && expr.text === 'require')
    || (compiler.isPropertyAccessExpression(expr) && expr.name.text === 'require');
}

function argumentOf(compiler: typeof ts, node: ts.Node): { argument: ts.Node | undefined } | null {
  if (compiler.isImportDeclaration(node) || compiler.isExportDeclaration(node)) {
    return node.moduleSpecifier ? { argument: node.moduleSpecifier } : null;
  }
  if (compiler.isImportEqualsDeclaration(node) && compiler.isExternalModuleReference(node.moduleReference)) {
    return { argument: node.moduleReference.expression };
  }
  if (compiler.isCallExpression(node) && isLoaderCall(compiler, node.expression)) return { argument: node.arguments[0] };
  if (compiler.isImportTypeNode(node)) {
    return { argument: compiler.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined };
  }
  return null;
}

function overridden(compiler: typeof ts, source: ts.SourceFile, node: ts.Node, line: number): boolean {
  let statement = node;
  while (statement.parent && !compiler.isStatement(statement)) statement = statement.parent;
  const comments = [
    ...(compiler.getLeadingCommentRanges(source.text, statement.getFullStart()) ?? []),
    ...(compiler.getTrailingCommentRanges(source.text, node.end) ?? []),
  ];
  return comments.some(comment => {
    const commentLine = source.getLineAndCharacterOfPosition(comment.pos).line;
    return commentLine >= line - 1 && commentLine <= line
      && /^\/\/[ \t]*quality-ok:[ \t]*import-boundary[ \t]*[—–-][ \t]*\S[^\n]*$/.test(source.text.slice(comment.pos, comment.end));
  });
}

function allNamedTypes(node: ts.NamedImports | ts.NamedExports): boolean {
  return node.elements.length > 0 && node.elements.every(element => element.isTypeOnly);
}

function elidedImport(compiler: typeof ts, node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause || clause.name || !clause.namedBindings) return false;
  return compiler.isNamedImports(clause.namedBindings) && allNamedTypes(clause.namedBindings);
}

function elidedExport(compiler: typeof ts, node: ts.ExportDeclaration): boolean {
  return node.exportClause !== undefined && compiler.isNamedExports(node.exportClause) && allNamedTypes(node.exportClause);
}

function typeOnly(compiler: typeof ts, node: ts.Node, verbatim: boolean): boolean {
  if (compiler.isImportTypeNode(node)) return true;
  if (compiler.isImportDeclaration(node)) return node.importClause?.isTypeOnly === true || (!verbatim && elidedImport(compiler, node));
  if (compiler.isExportDeclaration(node)) return node.isTypeOnly
    || (!verbatim && elidedExport(compiler, node));
  return compiler.isImportEqualsDeclaration(node) && node.isTypeOnly;
}

export function importEdges(compiler: typeof ts, source: ts.SourceFile, verbatimModuleSyntax = true): ImportEdge[] {
  const edges: ImportEdge[] = [];
  const visit = (node: ts.Node): void => {
    const found = argumentOf(compiler, node);
    if (found) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
      edges.push({
        specifier: found.argument && compiler.isStringLiteralLike(found.argument) ? found.argument.text : null,
        typeOnly: source.isDeclarationFile || typeOnly(compiler, node, verbatimModuleSyntax),
        line: line + 1, overridden: overridden(compiler, source, node, line),
      });
    }
    compiler.forEachChild(node, visit);
  };
  visit(source);
  return edges;
}
