-- Aggregate read of the latest raw backup projection. Returns no transaction IDs,
-- descriptions, documents, counterparties or financial values.
with origins as (
  select mapped_data->>'institution' as bank,
         mapped_data->>'account_type' as account_type,
         mapped_data->'latest_raw' as raw
  from public.import_rows
  where mapped_data->>'source'='pluggy'
), fields as (
  select bank, account_type,
    nullif(raw->>'description','') is not null as description,
    nullif(raw->>'descriptionRaw','') is not null as original,
    nullif(raw#>>'{merchant,name}','') is not null as commercial_name,
    nullif(raw#>>'{merchant,businessName}','') is not null as legal_name,
    nullif(raw#>>'{merchant,cnpj}','') is not null as merchant_cnpj,
    coalesce(raw#>>'{creditCardMetadata,payeeMCC}',raw#>>'{merchant,mcc}',raw->>'mcc','') ~ '^[0-9]{4}$'
      and coalesce(raw#>>'{creditCardMetadata,payeeMCC}',raw#>>'{merchant,mcc}',raw->>'mcc') <> '0000' as mcc,
    nullif(coalesce(raw#>>'{merchant,category}',raw#>>'{merchant,mccDescription}',raw#>>'{creditCardMetadata,payeeMCCDescription}'),'') is not null as sector,
    nullif(raw#>>'{merchant,cnae}','') is not null as cnae,
    nullif(coalesce(raw#>>'{merchant,address}',raw#>>'{merchant,location,address}',raw->>'merchantAddress'),'') is not null as address,
    nullif(coalesce(raw#>>'{merchant,city}',raw#>>'{merchant,address,city}',raw#>>'{merchant,location,city}'),'') is not null as city,
    nullif(coalesce(raw#>>'{merchant,latitude}',raw#>>'{merchant,location,latitude}',raw#>>'{merchant,location,coordinates}'),'') is not null as coordinates,
    nullif(coalesce(raw#>>'{merchant,id}',raw->>'merchantId',raw#>>'{creditCardMetadata,merchantId}'),'') is not null as merchant_id,
    nullif(coalesce(raw#>>'{merchant,acquirerId}',raw->>'acquirerId',raw#>>'{creditCardMetadata,acquirerId}'),'') is not null as acquirer,
    jsonb_typeof(raw->'creditCardMetadata')='object' and raw->'creditCardMetadata'<>'{}'::jsonb as card_metadata,
    nullif(raw->>'category','') is not null as provider_category,
    nullif(raw->>'categoryId','') is not null as provider_category_id,
    nullif(coalesce(raw#>>'{paymentData,receiver,name}',raw#>>'{paymentData,payer,name}'),'') is not null as party_name,
    coalesce(raw#>>'{paymentData,receiver,documentNumber,type}','') ilike '%cnpj%' or
      coalesce(raw#>>'{paymentData,payer,documentNumber,type}','') ilike '%cnpj%' as party_declared_cnpj
  from origins
)
select bank, account_type, count(*) as records,
  count(*) filter(where description) as description,
  count(*) filter(where original) as original,
  count(*) filter(where commercial_name) as commercial_name,
  count(*) filter(where legal_name) as legal_name,
  count(*) filter(where merchant_cnpj) as merchant_cnpj,
  count(*) filter(where mcc) as mcc,
  count(*) filter(where sector) as sector,
  count(*) filter(where cnae) as cnae,
  count(*) filter(where address) as address,
  count(*) filter(where city) as city,
  count(*) filter(where coordinates) as coordinates,
  count(*) filter(where merchant_id) as merchant_id,
  count(*) filter(where acquirer) as acquirer,
  count(*) filter(where card_metadata) as card_metadata,
  count(*) filter(where provider_category) as provider_category,
  count(*) filter(where provider_category_id) as provider_category_id,
  count(*) filter(where party_name) as party_name,
  count(*) filter(where party_declared_cnpj) as party_declared_cnpj
from fields group by bank, account_type order by bank, account_type;
