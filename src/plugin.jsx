// Hermes Arrow: games for the time your agent spends working.
// This file only plugs the console into the Desktop. The console is src/console; the games are
// cartridges, either built in (src/cartridges) or dropped in as plugins of their own (docs/CARTRIDGES.md).

import { COMPOSER_AREAS, PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, STATUSBAR_AREAS } from '@hermes/plugin-sdk';
import { createConsole, ID, ROUTE } from './console/console.jsx';
import arrow from './cartridges/arrow/index.jsx';

export default {
  id: ID,
  name: 'Hermes Arrow',
  description: 'An arrow-escape puzzle for the wait. Boards scale with how long and hard your agent is working.',
  register(ctx) {
    // Arrow keeps the storage keys it has always had.
    const app = createConsole(ctx, [{ cart: arrow, prefix: '' }]);
    ctx.onDispose(app.dispose);
    // A registration that fails must not leave our listeners on the host's stores.
    try { this.contribute(ctx, app); } catch (error) { app.dispose(); throw error; }
    // Test harness seam: absent in the app, so this is a no-op there.
    globalThis.__hermesArrowDebug?.(app);
  },
  contribute(ctx, app) {
    ctx.registerMany([
      { id: 'page', area: ROUTES_AREA, data: { path: ROUTE }, render: () => <app.Page /> },
      { id: 'nav', area: SIDEBAR_NAV_AREA, order: 90, data: { path: ROUTE, label: 'Arrow', codicon: 'arrow-right' } },
      { id: 'chip', area: STATUSBAR_AREAS.right, order: 85, render: () => <app.Chip /> },
      COMPOSER_AREAS.microActions
        ? { id: 'offer', area: COMPOSER_AREAS.microActions, data: { resolve: app.offers } }
        : { id: 'offer', area: COMPOSER_AREAS.underside, render: () => <app.OfferLink /> },
      { id: 'open', area: PALETTE_AREA, data: { id: `${ID}.open`, label: 'Hermes Arrow: Play', keywords: ['game', 'arrow', 'puzzle', 'wait', 'play'], run: app.open } },
      // Read-only: the draft passes through untouched. Its wording seeds the difficulty estimate.
      { id: 'prompt', area: COMPOSER_AREAS.middleware, data: { handler: draft => { try { app.tracker.sawPrompt(draft); } catch { /* never block a send */ } return draft; } } }
    ]);
  }
};
