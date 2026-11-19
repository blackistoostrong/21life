import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Explicit owners: expanding a feature requires extending this inventory.
export const featureOwners = {
  web: [
    'hooks/use-profile-catalog-actions.ts', 'hooks/use-profile-account-export.ts',
    'hooks/use-profile-deck-link.ts',
    'hooks/use-profile-deck-refresh.ts',
    'hooks/use-profile-deck-collection.ts',
    'app/table/[id]/page.tsx', 'app/profile/page.tsx',
    'components/live-game/web-live-game.tsx',
    'components/arena/arena-settings-editor.tsx',
    'hooks/use-arena-match-history.ts', 'hooks/use-arena-analytics.ts',
    'hooks/use-arena-season-context.ts', 'hooks/use-arena-day-export.ts',
    'hooks/use-profile-metrics.ts', 'hooks/use-web-tracker-display.ts', 'hooks/use-web-tracker-setup.ts',
    'hooks/use-profile-catalog.ts', 'hooks/use-profile-metadata-enrichment.ts',
    'hooks/use-profile-manual-deck.ts', 'hooks/use-profile-deck-persistence.ts', 'hooks/use-platform-admin.tsx', 'hooks/use-profile-archidekt-autosync.ts', 'hooks/use-profile-archidekt-settings.ts', 'hooks/use-profile-commander-editor.ts', 'hooks/use-profile-command-scope.ts', 'hooks/use-profile-archidekt-import.ts', 'hooks/use-profile-url-import.ts', 'hooks/use-profile-commander-arts.ts',
    'hooks/use-profile-commander-search.ts', 'lib/profile-commander.ts', 'hooks/use-profile-directory.ts', 'hooks/use-profile-account-credentials.ts', 'hooks/use-profile-password-change.ts', 'lib/profile-password.ts',
  ],
  native: [
    'expo/app/table/[id]/play.tsx', 'expo/app/table/[id]/index.tsx',
    'expo/hooks/use-arena.ts', 'expo/hooks/use-arena-history.ts',
    'expo/hooks/use-arena-analytics.ts', 'expo/hooks/use-arena-season-context.ts',
    'expo/hooks/use-arena-day-export.ts', 'expo/hooks/use-profile-decks.ts',
  ],
  presentation: [
    'components/profile/profile-deck-link-dialog.tsx',
    'components/profile/profile-deck-filters.tsx',
    'components/profile/profile-deck-grid.tsx',
    'components/profile/profile-deck-import-forms.tsx', 'components/profile/commander-art-picker.tsx', 'components/profile/deck-source-badge.tsx',
    'components/profile/profile-manual-deck-form.tsx', 'components/profile/profile-deck-overwrite-dialog.tsx', 'components/profile/profile-archidekt-settings-panel.tsx', 'components/profile/profile-account-panel.tsx', 'components/profile/profile-nickname-directory.tsx',
    'components/arena/guest-directory.tsx',
    'components/arena/arena-data-status.tsx',
    'components/arena/arena-history-pagination.tsx',
    'components/live-game/web-sync-badge.tsx',
    'components/live-game/web-journal-warning.tsx',
    'components/live-game/web-tracker-wizard.tsx',
    'components/live-game/web-completed-game.tsx',
    'expo/components/table/table-guests-section.tsx',
    'expo/components/table/arena-analytics-status.tsx',
  ],
  // Existing image container owns its own cache/network lifecycle. Composition
  // may delegate to it; this does not authorize data access in the guest panel.
  delegates: {
    'components/profile/profile-deck-grid.tsx': ['components/deck-image.tsx', 'components/deck/edhrec-badge.tsx'],
    'components/profile/profile-deck-import-forms.tsx': ['components/deck-image.tsx', 'components/deck/edhrec-badge.tsx'],
    'components/profile/commander-art-picker.tsx': ['components/deck-image.tsx'],
    'components/profile/profile-manual-deck-form.tsx': ['components/deck-image.tsx'],
    'expo/components/table/table-guests-section.tsx': ['expo/components/deck/deck-image.tsx'],
    'components/live-game/web-tracker-wizard.tsx': ['components/arena/occasional-deck-form.tsx'],
  },
};

function imports(source, ts, includeTypes = false) {
  const dependencies = [];
  const add = (value) => dependencies.push(value && ts.isStringLiteral(value) ? value.text : null);
  function walk(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const allTypes = bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0
        && bindings.elements.every((item) => item.isTypeOnly) && !clause.name;
      if (includeTypes || (!clause?.isTypeOnly && !allTypes)) add(node.moduleSpecifier);
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && (includeTypes || !node.isTypeOnly)) {
      const allTypes = node.exportClause && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.length > 0 && node.exportClause.elements.every((item) => item.isTypeOnly);
      if (includeTypes || !allTypes) add(node.moduleSpecifier);
    }
    if (includeTypes && ts.isImportTypeNode(node)) add(node.argument.literal);
    if (ts.isImportEqualsDeclaration(node) && (includeTypes || !node.isTypeOnly)
      && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) add(node.arguments[0]);
    ts.forEachChild(node, walk);
  }
  walk(source);
  return dependencies;
}

/** Runtime graph only: type imports do not allocate SDKs, listeners or journals. */
export function verifyFeatureBoundaries(root, ts, owners = featureOwners) {
  const errors = new Set();
  const show = (file) => relative(root, file).replaceAll('\\', '/');
  const inside = (file, directory) => {
    const path = relative(resolve(root, directory), file);
    return path === '' || (!path.startsWith('..') && !path.startsWith('/') && !path.includes(':'));
  };
  const parse = (file) => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  function files(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = resolve(directory, entry.name);
      return entry.isDirectory() ? files(file) : /\.tsx?$/.test(file) ? [file] : [];
    });
  }
  // Data transports accept clients through typed inputs. No UI or runtime SDK imports.
  const dataFiles = files(resolve(root, 'packages/data'));
  for (const file of dataFiles) {
    for (const dependency of imports(parse(file), ts, true)) {
      const target = dependency && resolve(dirname(file), dependency);
      if (!dependency?.startsWith('.') || !(inside(target, 'packages/data') || inside(target, 'packages/domain'))) {
        errors.add(`${show(file)}: data dependency outside data/domain: ${dependency ?? '<dynamic>'}`);
      }
    }
  }

  for (const realm of ['web', 'native']) {
    const base = realm === 'native' ? resolve(root, 'expo') : root;
    const config = ts.readConfigFile(resolve(base, 'tsconfig.json'), ts.sys.readFile);
    if (config.error) throw new Error(`Cannot read ${realm} TypeScript configuration`);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, base);
    if (parsed.errors.length) throw new Error(`Invalid ${realm} TypeScript configuration`);
    const cache = ts.createModuleResolutionCache(base, (name) => ts.sys.useCaseSensitiveFileNames ? name : name.toLowerCase(), parsed.options);
    const graph = new Map();
    const roots = [...owners[realm], ...dataFiles.map(show),
      ...owners.presentation.filter((file) => file.startsWith('expo/') === (realm === 'native'))];

    function visit(file) {
      if (graph.has(file)) return;
      graph.set(file, []);
      for (const dependency of imports(parse(file), ts)) {
        if (dependency === null) {
          errors.add(`${show(file)}: non-static runtime module access`);
          continue;
        }
        const forbidden = realm === 'web'
          ? /^(react-native(?:\/|$)|@react-native\/|expo(?:$|[-/])|@expo\/)/
          : /^(next(?:\/|$)|react-dom(?:\/|$)|server-only$)/;
        if (forbidden.test(dependency)) errors.add(`${show(file)}: ${realm} imports forbidden runtime ${dependency}`);
        const target = ts.resolveModuleName(dependency, file, parsed.options, ts.sys, cache).resolvedModule?.resolvedFileName;
        if (!target || target.includes('/node_modules/') || target.includes('\\node_modules\\') || target.endsWith('.d.ts')) continue;
        if (!inside(target, '.')) continue;
        const wrongSide = realm === 'web' ? ['expo/app', 'expo/components', 'expo/hooks'] : ['app', 'components', 'hooks'];
        if (wrongSide.some((directory) => inside(target, directory))) {
          errors.add(`${show(file)}: ${realm} imports other platform UI ${show(target)}`);
        }
        graph.get(file).push(target);
        visit(target);
      }
    }
    for (const file of roots) visit(resolve(root, file));

    const done = new Set();
    const stack = [];
    function cycle(file) {
      if (stack.includes(file)) {
        errors.add(`circular feature dependency: ${[...stack.slice(stack.indexOf(file)), file].map(show).join(' -> ')}`);
        return;
      }
      if (done.has(file)) return;
      stack.push(file);
      for (const next of graph.get(file) ?? []) cycle(next);
      stack.pop();
      done.add(file);
    }
    for (const file of graph.keys()) cycle(file);

    for (const presentation of owners.presentation.filter((file) => roots.includes(file))) {
      const visited = new Set();
      function check(file) {
        if (visited.has(file)) return;
        visited.add(file);
        const name = show(file);
        if (owners.delegates?.[presentation]?.includes(name)) return;
        const source = parse(file);
        const sdk = imports(source, ts).some((dependency) => dependency?.startsWith('@supabase/'));
        const resource = /(?:^|\/)lib\/(?:supabase(?:\.|\/)|live-game-(?:offline|journal|service))/.test(name)
          || inside(file, 'packages/data');
        if (sdk || resource) errors.add(`${presentation}: presentation reaches data/journal owner ${name}`);
        for (const next of graph.get(file) ?? []) check(next);
      }
      check(resolve(root, presentation));
    }
  }
  return [...errors].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const ts = createRequire(resolve(process.cwd(), 'package.json'))('typescript');
  const errors = verifyFeatureBoundaries(root, ts);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('Feature runtime graphs, data and presentation boundaries verified.');
}
