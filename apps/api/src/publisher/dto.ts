import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class MoneyDto {
  @Matches(/^[A-Z]{3}$/) currency: string;
  @IsInt() @Min(0) @Max(10_000_000_00) amount_minor: number;
}
export class RegisterPublisherDto {
  @IsString() @Length(2, 200) legal_name: string;
  @IsString() @Length(2, 200) display_name: string;
  @Matches(/^[A-Za-z]{2}$/) country_code: string;
  @IsOptional() @IsBoolean() is_individual_author?: boolean;
}
export class PublisherBookInput {
  @IsOptional() @IsUUID() publisher_id?: string;
  @IsString() @Length(1, 300) title: string;
  @IsOptional() @IsString() @MaxLength(10000) description?: string;
  @Matches(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/) language_code: string;
  @IsOptional() @Matches(/^[0-9X-]{10,17}$/) isbn?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) author_ids?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) category_ids?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => MoneyDto) prices?: MoneyDto[];
}
export class UploadIntentDto {
  @IsIn(['COVER', 'PREVIEW', 'EPUB', 'PDF', 'COMIC', 'AUDIOBOOK', 'SOURCE_FILE']) kind: string;
  @IsString() @MaxLength(100) mime_type: string;
  @IsInt() @Min(1) @Max(2 * 1024 ** 3) size_bytes: number;
  @Matches(/^[a-fA-F0-9]{64}$/) checksum_sha256: string;
}
export class ReasonDto { @IsString() @Length(3, 2000) reason: string; }
export class ContractDto {
  @IsUUID() edition_id: string;
  @IsInt() @Min(0) @Max(10000) commission_bps: number;
  @IsString() start_at: string;
  @IsOptional() @IsString() end_at?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => TerritoryDto) territories: TerritoryDto[];
}
export class TerritoryDto {
  @Matches(/^(WW|[A-Z]{2})$/) country_code: string;
  @IsIn(['SELL', 'DENY']) permission_type: 'SELL' | 'DENY';
}
