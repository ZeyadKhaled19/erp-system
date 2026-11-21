import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { todayISO } from '@erp/shared';
import type { FastifyRequest } from 'fastify';
import type { Db } from '../../db';
import { integrityCheck } from '../../integrity';
import { shiftExpected } from '../../ops';
import * as R from '../../reports';
import { Perm } from '../../core/access';
import { DB } from '../../core/tokens';
import { ReportsService } from './reports.service';

type Q = Record<string, string | undefined>;
/** فترة التقرير: الخانة الفاضية = بدون حد (زي قبل) */
const range = (q: Q) => ({ from: q.from || undefined, to: q.to || undefined });

@Controller('api')
export class ReportsController {
  constructor(@Inject(DB) private db: Db, @Inject(ReportsService) private reports: ReportsService) {}

  @Get('reports/dashboard')
  dashboard(@Req() req: FastifyRequest, @Query() q: Q) {
    return this.reports.dashboard(req.user!, q.today || todayISO());
  }

  @Perm('reports.financial')
  @Get('reports/trial-balance')
  trialBalance(@Query() q: Q) {
    return R.trialBalance(this.db, range(q));
  }

  @Perm('reports.financial')
  @Get('reports/ledger/:id')
  ledger(@Param('id') id: string, @Query() q: Q) {
    return R.ledger(this.db, id, { ...range(q), party_id: q.party_id });
  }

  @Perm('reports.profit')
  @Get('reports/income-statement')
  incomeStatement(@Query() q: Q) {
    return R.incomeStatement(this.db, range(q));
  }

  @Perm('reports.profit')
  @Get('reports/cash-result')
  cashResult(@Query() q: Q) {
    return R.cashResult(this.db, range(q));
  }

  @Perm('reports.financial')
  @Get('reports/balance-sheet')
  balanceSheet(@Query() q: Q) {
    return R.balanceSheet(this.db, q.to || todayISO());
  }

  @Perm('parties.view')
  @Get('reports/party/:id')
  party(@Param('id') id: string, @Query() q: Q) {
    return R.partyStatement(this.db, id, { ...range(q), items: q.items === '1' });
  }

  @Perm('treasury.view')
  @Get('reports/cashbox/:id')
  cashbox(@Req() req: FastifyRequest, @Param('id') id: string, @Query() q: Q) {
    return this.reports.cashboxMovement(req.user!, id, range(q));
  }

  @Perm('inventory.view')
  @Get('reports/item/:id')
  item(@Req() req: FastifyRequest, @Param('id') id: string, @Query() q: Q) {
    return this.reports.itemMovement(req.user!, id, { ...range(q), warehouse_id: q.warehouse_id, doc_type: q.doc_type });
  }

  @Perm('inventory.view')
  @Get('reports/warehouse-stock')
  warehouseStock(@Req() req: FastifyRequest, @Query() q: Q) {
    return this.reports.warehouseStock(req.user!, q.warehouse_id, q.nonzero === '1');
  }

  @Perm('inventory.view')
  @Get('reports/warehouse-movement/:id')
  warehouseMovement(@Req() req: FastifyRequest, @Param('id') id: string, @Query() q: Q) {
    return this.reports.warehouseMovement(req.user!, id, { ...range(q), item_id: q.item_id });
  }

  @Perm('inventory.view')
  @Get('reports/reorder')
  reorder(@Req() req: FastifyRequest) {
    return R.reorderReport(this.db, req.user!.warehouse_ids);
  }

  @Perm('reports.view')
  @Get('reports/documents')
  documents(@Req() req: FastifyRequest, @Query() q: Q) {
    return this.reports.documents(req.user!, { ...range(q), types: q.types, party_id: q.party_id, user_id: q.user_id, status: q.status, warehouse_id: q.warehouse_id });
  }

  @Get('documents/:id')
  document(@Req() req: FastifyRequest, @Param('id') id: string) {
    return this.reports.documentDetail(req.user!, id);
  }

  @Get('documents/:id/amendment')
  amendment(@Req() req: FastifyRequest, @Param('id') id: string) {
    return this.reports.amendment(req.user!, id);
  }

  @Perm('reports.view')
  @Get('reports/commissions')
  commissions(@Query() q: Q) {
    return R.commissionsReport(this.db, range(q));
  }

  @Perm('reports.financial')
  @Get('admin/integrity')
  integrity() {
    return integrityCheck(this.db);
  }

  @Perm('reports.financial')
  @Get('reports/closing-preview')
  closingPreview(@Query() q: Q) {
    return R.closingPreview(this.db, q.to || todayISO());
  }

  @Perm('partners.view')
  @Get('reports/partners')
  partners(@Query() q: Q) {
    return R.partnersReport(this.db, range(q));
  }

  @Perm('inventory.view')
  @Get('reports/serial')
  serial(@Req() req: FastifyRequest, @Query() q: Q) {
    return R.serialSearch(this.db, q.q ?? '', req.user!.warehouse_ids);
  }

  @Perm('inventory.view')
  @Get('reports/expiry')
  expiry(@Req() req: FastifyRequest, @Query() q: Q) {
    return this.reports.expiry(req.user!, { warehouse_id: q.warehouse_id, until: q.until });
  }

  @Perm('reports.view')
  @Get('reports/sales-analysis')
  salesAnalysis(@Req() req: FastifyRequest, @Query() q: Q) {
    return this.reports.salesAnalysis(req.user!, { ...range(q), group: q.group, kind: q.kind });
  }

  @Perm('treasury.view')
  @Get('reports/treasury-analysis')
  treasuryAnalysis(@Req() req: FastifyRequest, @Query() q: Q) {
    return this.reports.treasuryAnalysis(req.user!, { ...range(q), dir: q.dir, group: q.group, cashbox_id: q.cashbox_id, user_id: q.user_id, internal: q.internal });
  }

  @Perm('reports.view')
  @Get('reports/daily')
  daily(@Req() req: FastifyRequest, @Query() q: Q) {
    return this.reports.daily(req.user!, { ...range(q), user_id: q.user_id });
  }

  @Perm('treasury.shift')
  @Get('shifts/:id/expected')
  async shiftExpected(@Param('id') id: string) {
    const r = await shiftExpected(this.db, id);
    return { expected: r.expected, movement: r.movement, opening_float: r.shift.opening_float };
  }
}
