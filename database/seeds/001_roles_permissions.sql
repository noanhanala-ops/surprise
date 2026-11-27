INSERT INTO roles (name) VALUES ('customer'),('publisher_owner'),('publisher_editor'),('publisher_finance'),
  ('admin_catalog'),('admin_finance'),('admin_support'),('super_admin') ON CONFLICT DO NOTHING;
INSERT INTO permissions (code) VALUES
  ('catalog.publisher.approve'),('catalog.book.approve'),('catalog.book.suspend'),
  ('catalog.price.manage'),('catalog.territory.manage'),('contracts.manage'),
  ('orders.read_all'),('payments.read_all'),('refunds.decide'),('entitlements.revoke'),
  ('users.manage'),('audit.read'),('content.processing.monitor'),('royalties.payout.approve')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p WHERE r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
  ('catalog.publisher.approve','catalog.book.approve','catalog.book.suspend','catalog.price.manage','catalog.territory.manage','contracts.manage','content.processing.monitor')
  WHERE r.name='admin_catalog' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
  ('orders.read_all','payments.read_all','refunds.decide','royalties.payout.approve','audit.read')
  WHERE r.name='admin_finance' ON CONFLICT DO NOTHING;
