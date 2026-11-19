import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const root = process.cwd();

const protectedRoutes = [
  'app/api/deck-import/route.ts',
  'app/api/auth/export-account/route.ts',
  'app/api/archidekt-user-decks/route.ts',
  'app/api/scryfall-commanders/route.ts',
  'app/api/scryfall-card-arts/route.ts',
  'app/api/edhrec-commander/route.ts',
  'app/api/edhrec-resolve/route.ts',
  'app/api/profile/deck-refresh-budget/route.ts',
  'app/api/notifications/route.ts',
  'app/api/notifications/match-completed/route.ts',
];

const authenticatedFetchClients = [
  'hooks/use-profile-url-import.ts',
  'hooks/use-profile-archidekt-import.ts',
  'hooks/use-profile-archidekt-autosync.ts',
  'hooks/use-profile-commander-arts.ts',
  'hooks/use-profile-commander-editor.ts',
  'hooks/use-profile-deck-refresh.ts',
  'hooks/use-profile-deck-link.ts',
  'hooks/use-profile-metadata-enrichment.ts',
  'lib/profile-commander.ts',
  'app/table/[id]/page.tsx',
  'lib/deck-color-sync.ts',
  'components/deck/edhrec-badge.tsx',
  'components/arena/guest-commander-picker.tsx',
  'components/notification-center.tsx',
];

describe('protected routes', () => {
  it('requires auth on sensitive API routes', () => {
    for (const routePath of protectedRoutes) {
      const source = readFileSync(join(root, routePath), 'utf8');
      expect(source, routePath).toMatch(/requireAuthOr401|createServerSupabaseClient/);
    }
  });

  it('uses authenticatedFetch in protected client modules', () => {
    for (const filePath of authenticatedFetchClients) {
      const source = readFileSync(join(root, filePath), 'utf8');
      const parsed = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      let authenticatedCalls = 0;
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'authenticatedFetch') authenticatedCalls += 1;
        ts.forEachChild(node, visit);
      };
      visit(parsed);
      expect(authenticatedCalls, filePath).toBeGreaterThan(0);
    }
  });

  it('keeps private profile IO in feature owners rather than the compositional route', () => {
    const source = readFileSync(join(root, 'app/profile/page.tsx'), 'utf8');
    expect(source).not.toMatch(/@supabase\/|@\/lib\/(?:supabase|authenticated-fetch)/);
    const parsed = ts.createSourceFile('profile.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const directTransports: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        if ((ts.isIdentifier(expression) && ['fetch', 'authenticatedFetch'].includes(expression.text))
          || (ts.isPropertyAccessExpression(expression) && expression.name.text === 'fetch')) {
          directTransports.push(expression.getText(parsed));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    expect(directTransports).toEqual([]);
  });
});
