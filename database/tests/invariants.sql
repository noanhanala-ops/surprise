-- Testes de invariantes de BD. Corre dentro de uma transacção revertida. Falha (ERROR) se uma invariante quebrar.
\set ON_ERROR_STOP on
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(sql text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'OK   %', label; RETURN; END;
  RAISE EXCEPTION 'FALHOU: % deveria ter sido rejeitado', label;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(c boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF c THEN RAISE NOTICE 'OK   %', label; ELSE RAISE EXCEPTION 'FALHOU: %', label; END IF; END $$;

-- Fixtures
INSERT INTO users (id,email,status,email_verified_at,country_code) VALUES
 ('00000000-0000-0000-0000-000000000001','Leitor@Example.com','ACTIVE',now(),'MZ');
INSERT INTO publishers (id,legal_name,display_name,slug,country_code,status) VALUES
 ('00000000-0000-0000-0000-0000000000a1','Editora Lda','Editora','editora','MZ','ACTIVE');
INSERT INTO books (id,slug,title) VALUES ('00000000-0000-0000-0000-0000000000b1','livro','Livro');
INSERT INTO book_editions (id,book_id,publisher_id,language_code,status,published_at) VALUES
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','pt','PUBLISHED',now());
INSERT INTO rights_contracts (id,publisher_id,book_edition_id,start_at,commission_bps) VALUES
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1',now()-interval '1 day',3000);
INSERT INTO rights_territories VALUES ('00000000-0000-0000-0000-0000000000c1','WW','SELL'),
                                      ('00000000-0000-0000-0000-0000000000c1','KP','DENY');

-- AC-01/identidade: email único case-insensitive
SELECT pg_temp.expect_error($$INSERT INTO users(email) VALUES ('leitor@example.com')$$, 'email duplicado (case-insensitive) rejeitado');
SELECT pg_temp.expect_error($$INSERT INTO users(email,status) VALUES ('x@y.com','ACTIVE')$$, 'conta ACTIVE sem email verificado rejeitada');

-- AC-04: territórios
SELECT pg_temp.expect_true(edition_sellable_in('00000000-0000-0000-0000-0000000000e1','MZ'), 'vendável em MZ (WW)');
SELECT pg_temp.expect_true(NOT edition_sellable_in('00000000-0000-0000-0000-0000000000e1','KP'), 'bloqueado em KP (DENY)');
UPDATE book_editions SET status='SUSPENDED' WHERE id='00000000-0000-0000-0000-0000000000e1';
SELECT pg_temp.expect_true(NOT edition_sellable_in('00000000-0000-0000-0000-0000000000e1','MZ'), 'edição suspensa não vendável');
UPDATE book_editions SET status='PUBLISHED' WHERE id='00000000-0000-0000-0000-0000000000e1';

-- Encomenda + pagamento
INSERT INTO orders (id,user_id,currency,subtotal_minor,tax_minor,total_minor,status,billing_country,idempotency_key,pricing_snapshot)
 VALUES ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-000000000001','USD',1000,0,1000,'PENDING_PAYMENT','MZ','k1','{}');
SELECT pg_temp.expect_error($$INSERT INTO orders (user_id,currency,subtotal_minor,tax_minor,total_minor,billing_country,idempotency_key,pricing_snapshot)
  VALUES ('00000000-0000-0000-0000-000000000001','USD',1000,0,1000,'MZ','k1','{}')$$, 'pedido duplicado (mesma idempotency key) rejeitado');
SELECT pg_temp.expect_error($$INSERT INTO orders (user_id,currency,subtotal_minor,tax_minor,total_minor,billing_country,idempotency_key,pricing_snapshot)
  VALUES ('00000000-0000-0000-0000-000000000001','USD',1000,100,1000,'MZ','k2','{}')$$, 'total incoerente rejeitado');
INSERT INTO order_items (id,order_id,edition_id,publisher_id,contract_id,unit_price_minor,commission_bps) VALUES
 ('00000000-0000-0000-0000-000000000d01','00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1',1000,3000);

-- AC-07: webhook repetido
INSERT INTO payment_events (provider,external_event_id,payload_hash,payload,signature_valid) VALUES ('mpesa','evt_1','\x00','{}',true);
SELECT pg_temp.expect_error($$INSERT INTO payment_events (provider,external_event_id,payload_hash,payload,signature_valid) VALUES ('mpesa','evt_1','\x00','{}',true)$$, 'webhook duplicado rejeitado');

-- AC-08: direito criado uma única vez
INSERT INTO entitlements (id,user_id,book_edition_id,order_item_id) VALUES
 ('00000000-0000-0000-0000-0000000000a9','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-000000000d01');
SELECT pg_temp.expect_error($$INSERT INTO entitlements (user_id,book_edition_id,order_item_id) VALUES
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-000000000d01')$$, 'segundo direito para o mesmo order_item rejeitado');
SELECT pg_temp.expect_error($$UPDATE entitlements SET expires_at = now() + interval '1 day'$$, 'compra com expiração rejeitada (permanente)');
SELECT pg_temp.expect_error($$UPDATE entitlements SET status='REVOKED'$$, 'revogação sem motivo/auditor rejeitada');
SELECT pg_temp.expect_error($$DELETE FROM entitlements$$, 'DELETE de entitlement proibido');
SELECT pg_temp.expect_error($$DELETE FROM orders$$, 'DELETE de order proibido');
SELECT pg_temp.expect_error($$DELETE FROM payment_events$$, 'DELETE de payment_event proibido');

-- AC-09: livro retirado do catálogo mantém direito activo
UPDATE book_editions SET status='DELISTED', delisted_at=now() WHERE id='00000000-0000-0000-0000-0000000000e1';
SELECT pg_temp.expect_true((SELECT status='ACTIVE' FROM entitlements WHERE id='00000000-0000-0000-0000-0000000000a9'), 'direito permanece ACTIVE após delist');

-- Royalties imutáveis e idempotentes
INSERT INTO royalty_ledger (publisher_id,order_item_id,eligible_amount_minor,percentage_bps,amount_minor,currency)
 VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000d01',1000,7000,700,'USD');
SELECT pg_temp.expect_error($$INSERT INTO royalty_ledger (publisher_id,order_item_id,eligible_amount_minor,percentage_bps,amount_minor,currency)
 VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000d01',1000,7000,700,'USD')$$, 'royalty duplicado por order_item rejeitado');
SELECT pg_temp.expect_error($$UPDATE royalty_ledger SET amount_minor = 1$$, 'UPDATE do ledger proibido');

-- AC-10: progresso versionado (compare-and-set)
INSERT INTO reading_progress (user_id,edition_id,locator_json,progress_percent) VALUES
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1','{"href":"c1.xhtml"}',10);
WITH u AS (UPDATE reading_progress SET version=version+1, progress_percent=50 WHERE user_id='00000000-0000-0000-0000-000000000001' AND version=1 RETURNING 1)
SELECT pg_temp.expect_true((SELECT count(*) FROM u)=1, 'CAS com versão correcta aplica');
WITH u AS (UPDATE reading_progress SET version=version+1, progress_percent=5 WHERE user_id='00000000-0000-0000-0000-000000000001' AND version=1 RETURNING 1)
SELECT pg_temp.expect_true((SELECT count(*) FROM u)=0, 'CAS com versão antiga é rejeitado (dispositivo desactualizado)');

-- AC-17: auditoria encadeada e imutável
INSERT INTO audit_log (actor_type,action,target_type,target_id) VALUES ('ADMIN','entitlement.revoke','entitlement','a'),('ADMIN','refund.approve','refund','b');
SELECT pg_temp.expect_true((SELECT count(*) FROM audit_log a JOIN audit_log b ON b.id=a.id+1 AND b.prev_hash=a.row_hash)=1, 'cadeia de hash da auditoria íntegra');
SELECT pg_temp.expect_error($$DELETE FROM audit_log$$, 'DELETE de auditoria proibido');

-- Preços: sem sobreposição temporal na mesma moeda
INSERT INTO book_prices (book_edition_id,currency,amount_minor,effective_from) VALUES ('00000000-0000-0000-0000-0000000000e1','USD',1000,now());
SELECT pg_temp.expect_error($$INSERT INTO book_prices (book_edition_id,currency,amount_minor,effective_from) VALUES ('00000000-0000-0000-0000-0000000000e1','USD',900,now()+interval '1 hour')$$, 'preços sobrepostos rejeitados');

ROLLBACK;
\echo '== todas as invariantes passaram =='
