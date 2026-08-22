import { ApiError } from './security';

const saleableCodes = new Set(['AD','AE','AF','AG','AI','AL','AM','AO','AR','AS','AT','AU','AW','AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BN','BO','BM','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EG','EE','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GE','GD','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','XK','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','MG','ME','MF','MH','MK','ML','MO','MM','MN','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW']);
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

export function getCountry(codeValue: unknown) {
  if (typeof codeValue !== 'string') throw new ApiError(400, 'Choose a country.');
  const code = codeValue.trim().toUpperCase();
  if (!saleableCodes.has(code)) throw new ApiError(400, 'Choose a valid country.');
  const name = regionNames.of(code);
  if (!name || name === code) throw new ApiError(400, 'Choose a valid country.');
  return { code, name };
}
