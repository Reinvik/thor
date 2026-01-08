
export type EntityType = 'THOR' | 'HUMAN' | 'WOLF' | 'DOG' | 'CRIMINAL' | 'HOUSE';

export interface Position {
  x: number;
  y: number;
}

export interface Entity {
  id: string;
  type: EntityType;
  pos: Position;
  velocity: Position;
  health: number;
  maxHealth: number;
  radius: number;
  speed: number;
  isDead: boolean;
  angle: number;
}

export interface GameState {
  status: 'START' | 'PLAYING' | 'WON' | 'LOST';
  score: number;
  distanceCovered: number;
}
