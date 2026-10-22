import { Controller, Get } from '@nestjs/common';
import { CurrencyCode } from '@ee/contracts';

const names = new Intl.DisplayNames(['es'], { type: 'region' });
// ISO 3166-1 alpha-2 codes ICU knows; computed once at boot.
const COUNTRIES = Array.from({ length: 26 * 26 }, (_, i) =>
  String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)),
)
  .map((code) => ({ code, name: names.of(code) ?? code }))
  .filter((c) => c.name !== c.code && !/^(EU|EZ|UN|QO|XA|XB|ZZ)$/.test(c.code))
  .sort((a, b) => a.name.localeCompare(b.name, 'es'));

@Controller('catalogs')
export class CatalogsController {
  @Get('countries')
  countries() {
    return COUNTRIES;
  }

  @Get('currencies')
  currencies() {
    return CurrencyCode.options;
  }
}
