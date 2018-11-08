import {
  Source,
  ASTNode,
  Kind,
  visit,
  BREAK,
  getVisitFn,
  TypeInfo,
  GraphQLSchema
} from "graphql";
import { SourceLocation, getLocation } from "graphql/language/location";

import { Position, Range } from "vscode-languageserver";

import { isNode } from "./graphql";

export function positionFromPositionInContainingDocument(
  source: Source,
  position: Position
) {
  if (!source.locationOffset) return position;
  return Position.create(
    position.line - (source.locationOffset.line - 1),
    position.character
  );
}

export function positionInContainingDocument(
  source: Source,
  position: Position
): Position {
  if (!source.locationOffset) return position;
  return Position.create(
    source.locationOffset.line - 1 + position.line,
    position.character
  );
}

export function rangeInContainingDocument(source: Source, range: Range): Range {
  if (!source.locationOffset) return range;
  return Range.create(
    positionInContainingDocument(source, range.start),
    positionInContainingDocument(source, range.end)
  );
}

export function rangeForASTNode(node: ASTNode): Range {
  const location = node.loc!;
  const source = location.source;

  return Range.create(
    positionFromSourceLocation(source, getLocation(source, location.start)),
    positionFromSourceLocation(source, getLocation(source, location.end))
  );
}

export function positionFromSourceLocation(
  source: Source,
  location: SourceLocation
) {
  return Position.create(
    (source.locationOffset ? source.locationOffset.line - 1 : 0) +
      location.line -
      1,
    location.column - 1
  );
}

export function positionToOffset(source: Source, position: Position): number {
  const lineRegexp = /\r\n|[\n\r]/g;

  const linesUntilPosition = source.body
    .split(lineRegexp)
    .slice(0, position.line);
  return (
    position.character +
    linesUntilPosition
      .map(
        line => line.length + 1 // count EOL
      )
      .reduce((a, b) => a + b, 0)
  );
}

export function getASTNodeAndTypeInfoAtPosition(
  source: Source,
  position: Position,
  root: ASTNode,
  schema: GraphQLSchema
): [ASTNode, TypeInfo] | null {
  const offset = positionToOffset(source, position);

  let nodeContainingPosition: ASTNode | null = null;

  const typeInfo = new TypeInfo(schema);
  visit(
    root,
    visitWithTypeInfo(typeInfo, {
      enter(node: ASTNode) {
        if (
          node.kind !== Kind.NAME && // We're usually interested in their parents
          node.loc &&
          node.loc.start <= offset &&
          offset <= node.loc.end
        ) {
          nodeContainingPosition = node;
        } else {
          return false;
        }
        return;
      },
      leave(node: ASTNode) {
        if (node.loc && node.loc.start <= offset && offset <= node.loc.end) {
          return BREAK;
        }
        return;
      }
    })
  );

  if (nodeContainingPosition) {
    return [nodeContainingPosition, typeInfo];
  } else {
    return null;
  }
}

/**
 * Creates a new visitor instance which maintains a provided TypeInfo instance
 * along with visiting visitor.
 */
export function visitWithTypeInfo(typeInfo: TypeInfo, visitor: any): any {
  return {
    enter(node: ASTNode) {
      typeInfo.enter(node);
      const fn = getVisitFn(visitor, node.kind, /* isLeaving */ false);
      if (fn) {
        const result = fn.apply(visitor, arguments);
        if (result !== undefined) {
          typeInfo.leave(node);
          if (isNode(result)) {
            typeInfo.enter(result);
          }
        }
        return result;
      }
    },
    leave(node: ASTNode) {
      const fn = getVisitFn(visitor, node.kind, /* isLeaving */ true);
      let result;
      if (fn) {
        result = fn.apply(visitor, arguments);
      }
      if (result !== BREAK) {
        typeInfo.leave(node);
      }
      return result;
    }
  };
}
