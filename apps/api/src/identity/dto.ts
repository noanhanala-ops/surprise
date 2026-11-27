import { IsEmail, IsIn, IsOptional, IsString, Length, MaxLength, MinLength, ValidateNested, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export class DeviceInfoDto {
  @IsString() @MaxLength(200) fingerprint: string;
  @IsIn(['WEB', 'ANDROID', 'IOS']) platform: 'WEB' | 'ANDROID' | 'IOS';
  @IsOptional() @IsString() @MaxLength(100) label?: string;
}
export class RegisterDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(12) @MaxLength(128) password: string;
  @IsString() @Length(1, 100) display_name: string;
  @Matches(/^[A-Za-z]{2}$/) country_code: string;
  @IsOptional() @IsString() @MaxLength(20) locale?: string;
}
export class LoginDto {
  @IsEmail() email: string;
  @IsString() @MaxLength(128) password: string;
  @IsOptional() @ValidateNested() @Type(() => DeviceInfoDto) device?: DeviceInfoDto;
}
export class RefreshDto { @IsString() @MaxLength(200) refresh_token: string; }
export class VerifyEmailDto { @IsString() @MaxLength(2000) token: string; }
