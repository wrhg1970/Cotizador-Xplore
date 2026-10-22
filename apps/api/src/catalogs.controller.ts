import { Controller, Get } from '@nestjs/common';
import { COUNTRIES, CurrencyCode } from '@ee/contracts';

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
