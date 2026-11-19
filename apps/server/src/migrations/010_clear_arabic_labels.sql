-- Simplify seeded account names without overwriting any names customized by an organization.
UPDATE accounts SET name = 'تكلفة البضاعة' WHERE system_key = 'cogs' AND name = 'تكلفة البضاعة المباعة';
UPDATE accounts SET name = 'مصروفات التشغيل' WHERE system_key = 'expenses_group' AND name = 'المصروفات العمومية والإدارية';
UPDATE accounts SET name = 'رواتب الموظفين' WHERE system_key = 'salaries' AND name IN ('رواتب وأجور', 'رواتب وأجور الموظفين');
UPDATE accounts SET name = 'رسوم البنك والدفع' WHERE system_key = 'payment_fees' AND name = 'عمولات بنكية وعمولات الدفع';
UPDATE accounts SET name = 'مصروفات أخرى' WHERE system_key = 'misc_expense' AND name = 'مصروفات متنوعة';
UPDATE accounts SET name = 'فرق جرد المخزون' WHERE system_key = 'inventory_diff' AND name = 'فروقات جرد المخزون';
UPDATE accounts SET name = 'تسوية تكلفة المرتجعات' WHERE system_key = 'cost_variance' AND name = 'فروق تكلفة المرتجعات';
UPDATE accounts SET name = 'فرق رصيد الخزينة' WHERE system_key = 'cash_over_short' AND name = 'عجز وزيادة الخزينة';
UPDATE accounts SET name = 'إنترنت واتصالات' WHERE id = 'acc-5204' AND name = 'اتصالات وإنترنت';
