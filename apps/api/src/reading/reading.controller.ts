import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../identity/jwt-auth.guard';
import { ReadingService } from './reading.service';

class SessionDto { @IsOptional() @IsUUID() device_id?: string; }
class ProgressDto {
  @IsObject() locator: any;
  @IsNumber() @Min(0) @Max(100) progress_percent: number;
  @IsInt() @Min(0) base_version: number;
  @IsOptional() @IsUUID() device_id?: string;
  @IsOptional() @IsString() client_updated_at?: string;
}
class BookmarkDto { @IsObject() locator: any; @IsOptional() @IsString() @MaxLength(300) title?: string; }
class HighlightDto {
  @IsObject() locator: any; @IsString() @MaxLength(5000) selected_text: string;
  @IsOptional() @IsString() @MaxLength(30) color?: string; @IsOptional() @IsString() @MaxLength(10000) note?: string;
}
class HighlightPatchDto { @IsOptional() @IsString() @MaxLength(30) color?: string; @IsOptional() @IsString() @MaxLength(10000) note?: string; }
class PrefsDto {
  @IsOptional() @IsString() @MaxLength(100) font_family?: string;
  @IsOptional() @IsInt() @Min(8) @Max(72) font_size?: number;
  @IsOptional() @IsIn(['LIGHT', 'DARK', 'SEPIA', 'AUTO']) theme?: string;
  @IsOptional() @IsNumber() @Min(1) @Max(3) line_spacing?: number;
}

@UseGuards(JwtAuthGuard)
@Controller('reading')
export class ReadingController {
  constructor(private svc: ReadingService) {}
  @Get('preferences') prefs(@CurrentUser() u: AuthUser) { return this.svc.getPreferences(u.id); }
  @Put('preferences') putPrefs(@CurrentUser() u: AuthUser, @Body() b: PrefsDto) { return this.svc.putPreferences(u.id, b); }

  @Post(':editionId/session') session(@CurrentUser() u: AuthUser, @Param('editionId', ParseUUIDPipe) e: string, @Body() b: SessionDto) { return this.svc.startSession(u.id, e, b.device_id); }
  @Get(':editionId/progress') progress(@CurrentUser() u: AuthUser, @Param('editionId', ParseUUIDPipe) e: string) { return this.svc.getProgress(u.id, e); }
  @Put(':editionId/progress') putProgress(@CurrentUser() u: AuthUser, @Param('editionId', ParseUUIDPipe) e: string, @Body() b: ProgressDto) { return this.svc.putProgress(u.id, e, b); }
  @Post(':editionId/bookmarks') bookmark(@CurrentUser() u: AuthUser, @Param('editionId', ParseUUIDPipe) e: string, @Body() b: BookmarkDto) { return this.svc.addBookmark(u.id, e, b.locator, b.title); }
  @Delete(':editionId/bookmarks/:id') @HttpCode(204) async delBookmark(@CurrentUser() u: AuthUser, @Param('editionId', ParseUUIDPipe) e: string, @Param('id', ParseUUIDPipe) id: string) { await this.svc.remove(u.id, e, 'bookmarks', id); }
  @Post(':editionId/highlights') highlight(@CurrentUser() u: AuthUser, @Param('editionId', ParseUUIDPipe) e: string, @Body() b: HighlightDto) { return this.svc.addHighlight(u.id, e, b.locator, b.selected_text, b.color, b.note); }
  @Put(':editionId/highlights/:id') patchHighlight(@CurrentUser() u: AuthUser, @Param('editionId', ParseUUIDPipe) e: string, @Param('id', ParseUUIDPipe) id: string, @Body() b: HighlightPatchDto) { return this.svc.updateHighlight(u.id, e, id, b); }
  @Delete(':editionId/highlights/:id') @HttpCode(204) async delHighlight(@CurrentUser() u: AuthUser, @Param('editionId', ParseUUIDPipe) e: string, @Param('id', ParseUUIDPipe) id: string) { await this.svc.remove(u.id, e, 'highlights', id); }
  @Get(':editionId/annotations') annotations(@CurrentUser() u: AuthUser, @Param('editionId', ParseUUIDPipe) e: string, @Query('since') since?: string) { return this.svc.annotations(u.id, e, since); }
}
