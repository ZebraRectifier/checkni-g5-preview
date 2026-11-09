\set ON_ERROR_STOP on
-- Disposable synthetic fixture only. No data from CHECKNI or a real retailer.
create extension if not exists pg_trgm;
create table catalog (
  retailer_id text not null, store_id text not null, locality_id text not null,
  source_product_id text not null, name text not null, active boolean not null,
  updated_at timestamptz not null
);
insert into catalog
select case when n <= 60000 then 'perekrestok' else 'other' end,
       case when n <= 60000 then 'delivery-test' else 'other-test' end,
       case when n <= 60000 then 'city-test' else 'other-city' end,
       lpad(n::text,8,'0'),
       case when n % 160 = 0 then 'Молоко тестовое ' || n
            when n % 160 = 1 then 'Шоколад с молоком ' || n
            else 'Продукт тестовый ' || n end,
       n % 11 <> 0, '2026-01-01 00:00:00+00'::timestamptz + n * interval '1 second'
from generate_series(1,90000) n;
create index catalog_scope_updated on catalog(retailer_id,store_id,locality_id,updated_at desc) where active = true;
create index catalog_name_raw_trgm on catalog using gin(name gin_trgm_ops) where active = true;
analyze catalog;
create temporary table baseline as
 select source_product_id,name,updated_at
 from catalog where active=true and retailer_id='perekrestok' and store_id='delivery-test'
 and locality_id='city-test'
 and (lower(name collate pg_catalog.pg_c_utf8) collate "C") like (lower('%молоко%' collate pg_catalog.pg_c_utf8) collate "C")
 order by updated_at desc,name,source_product_id;
\echo 'BASELINE explain analyze (synthetic only)'
explain (analyze,buffers,format text)
 select source_product_id,name,updated_at
 from catalog where active=true and retailer_id='perekrestok' and store_id='delivery-test'
 and locality_id='city-test'
 and (lower(name collate pg_catalog.pg_c_utf8) collate "C") like (lower('%молоко%' collate pg_catalog.pg_c_utf8) collate "C")
 order by updated_at desc,name,source_product_id limit 24 offset 0;
-- Candidate only on disposable database; operator class and expression match exact predicate.
create index catalog_name_normalized_trgm on catalog using gin ((lower(name collate pg_catalog.pg_c_utf8) collate "C") gin_trgm_ops) where active = true;
analyze catalog;
\echo 'CANDIDATE explain analyze (synthetic only)'
explain (analyze,buffers,format text)
 select source_product_id,name,updated_at
 from catalog where active=true and retailer_id='perekrestok' and store_id='delivery-test'
 and locality_id='city-test'
 and (lower(name collate pg_catalog.pg_c_utf8) collate "C") like (lower('%молоко%' collate pg_catalog.pg_c_utf8) collate "C")
 order by updated_at desc,name,source_product_id limit 24 offset 0;
do $test$
declare a text[]; b text[]; page_no integer;
begin
 for page_no in 0..2 loop
  select array_agg(source_product_id order by updated_at desc,name,source_product_id) into a
   from (select * from baseline order by updated_at desc,name,source_product_id limit 24 offset page_no*24) t;
  select array_agg(source_product_id order by updated_at desc,name,source_product_id) into b
   from (select source_product_id,name,updated_at from catalog where active=true
    and retailer_id='perekrestok' and store_id='delivery-test' and locality_id='city-test'
    and (lower(name collate pg_catalog.pg_c_utf8) collate "C") like (lower('%молоко%' collate pg_catalog.pg_c_utf8) collate "C")
    order by updated_at desc,name,source_product_id limit 24 offset page_no*24) t;
  if a is distinct from b then raise exception 'page % differs', page_no; end if;
 end loop;
 if (select count(*) from baseline) < 72 then raise exception 'fixture too small for 3 pages'; end if;
end
$test$;
select pg_size_pretty(pg_relation_size('catalog_name_normalized_trgm')) as candidate_index_size,
       (select count(*) from baseline) as matched_rows;
\echo 'Three pages match baseline IDs/order; indexed expression is only a candidate.'
