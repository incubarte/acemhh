alter table "public"."payments" add column "concept" text not null;

alter table "public"."payments" add column "is_cash" boolean not null default true;

alter table "public"."players" alter column "dni" drop not null;


