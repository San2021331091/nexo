export interface DbColumn { column_name: string; data_type: string; is_nullable: string; column_default: string | null; ordinal_position: number; }
export interface DbConstraint { constraint_name: string; constraint_type: string; column_name: string; foreign_table_name: string | null; foreign_column_name: string | null; }
export interface TableShape { columns: DbColumn[]; constraints: DbConstraint[]; }
export interface Channel { id: string; slug: string; name: string; category: string; logoUrl: string | null; type: 'channel'; playbackUrl: string | null; playbackKind: 'hls' | 'dash' | 'youtube' | 'iframe' | 'unavailable'; description: string | null; website: string | null; fbUrl: string | null; twUrl: string | null; youtubeUrl: string | null; isLive: boolean; active: boolean; supportsActive: boolean;
  /** Set by the background stream check: `youtube` when a dead stream was replaced by the channel's YouTube live stream. */
  streamStatus?: 'ok' | 'offline' | 'youtube';
  /** The channel's own stream, kept when `playbackUrl` was switched to YouTube. */
  originalPlaybackUrl?: string | null; }
