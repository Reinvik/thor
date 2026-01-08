
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GameState, Entity, Position } from './types';
import { 
  WORLD_WIDTH, WORLD_HEIGHT, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, 
  ENTITY_RADIUS, SPEEDS, COLORS 
} from './constants';
import { GoogleGenAI } from "@google/genai";

interface Bush {
  pos: Position;
  radius: number;
  rotation: number;
  leaves: {x: number, y: number, r: number}[];
}

interface GrassTuft {
  x: number;
  y: number;
  h: number;
  w: number;
}

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>({
    status: 'START',
    score: 0,
    distanceCovered: 0
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>();
  const audioCtx = useRef<AudioContext | null>(null);

  const thorRef = useRef<Entity & { attackFrame: number, barkFrame: number, lastAttackTime: number, lastBarkTime: number }>({
    id: 'thor',
    type: 'THOR',
    pos: { x: 100, y: WORLD_HEIGHT / 2 },
    velocity: { x: 0, y: 0 },
    health: 100,
    maxHealth: 100,
    radius: ENTITY_RADIUS.THOR,
    speed: SPEEDS.THOR,
    isDead: false,
    angle: 0,
    attackFrame: 0,
    barkFrame: 0,
    lastAttackTime: 0,
    lastBarkTime: 0
  });

  const humansRef = useRef<(Entity & { isHiding: boolean, targetBush: Bush | null })[]>([
    {
      id: 'human1',
      type: 'HUMAN',
      pos: { x: 50, y: WORLD_HEIGHT / 2 - 20 },
      velocity: { x: 0, y: 0 },
      health: 100,
      maxHealth: 100,
      radius: ENTITY_RADIUS.HUMAN,
      speed: SPEEDS.HUMAN,
      isDead: false,
      angle: 0,
      isHiding: false,
      targetBush: null
    },
    {
      id: 'human2',
      type: 'HUMAN',
      pos: { x: 50, y: WORLD_HEIGHT / 2 + 20 },
      velocity: { x: 0, y: 0 },
      health: 100,
      maxHealth: 100,
      radius: ENTITY_RADIUS.HUMAN,
      speed: SPEEDS.HUMAN,
      isDead: false,
      angle: 0,
      isHiding: false,
      targetBush: null
    }
  ]);

  const hidingTimerRef = useRef<number | null>(null);
  const [hidingTimeLeft, setHidingTimeLeft] = useState<number>(0);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Touch control states
  const touchDirections = useRef({ up: false, down: false, left: false, right: false });
  const touchActions = useRef({ attack: false, bark: false, hide: false });

  const bushesRef = useRef<Bush[]>(Array.from({ length: 45 }, (_, i) => {
    const radius = 45 + Math.random() * 25;
    return {
      pos: { 
        x: 400 + i * (WORLD_WIDTH / 45) + (Math.random() - 0.5) * 150, 
        y: 100 + Math.random() * (WORLD_HEIGHT - 200) 
      },
      radius,
      rotation: Math.random() * Math.PI * 2,
      leaves: Array.from({ length: 8 }, () => ({
        x: (Math.random() - 0.5) * radius * 0.8,
        y: (Math.random() - 0.5) * radius * 0.8,
        r: radius * (0.4 + Math.random() * 0.3)
      }))
    };
  }));

  const grassTuftsRef = useRef<GrassTuft[]>(Array.from({ length: 300 }, () => ({
    x: Math.random() * WORLD_WIDTH,
    y: Math.random() * WORLD_HEIGHT,
    h: 5 + Math.random() * 15,
    w: 2 + Math.random() * 3
  })));

  const enemiesRef = useRef<(Entity & { hitFrame: number })[]>([]);
  const particlesRef = useRef<{x: number, y: number, vx: number, vy: number, life: number, color: string, size: number}[]>([]);
  const keysPressed = useRef<Set<string>>(new Set());
  const cameraX = useRef(0);
  const aiThoughtRef = useRef<string>("¡Nadie tocará a mi familia!");
  const lastThoughtTime = useRef(0);

  const playSound = (freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.1) => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = audioCtx.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(10, freq / 4), ctx.currentTime + duration);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  };

  const playBarkSound = () => {
    playSound(180, 0.15, 'triangle', 0.2);
    setTimeout(() => playSound(140, 0.1, 'triangle', 0.15), 50);
  };

  const createParticles = (x: number, y: number, color: string, count = 8, speed = 4) => {
    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        x, y,
        vx: (Math.random() - 0.5) * speed,
        vy: (Math.random() - 0.5) * speed,
        life: 1.0,
        color,
        size: 2 + Math.random() * 4
      });
    }
  };

  const resolveCollision = (e1: Entity, e2: Entity) => {
    const dx = e1.pos.x - e2.pos.x;
    const dy = e1.pos.y - e2.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = e1.radius + e2.radius;

    if (dist < minDist) {
      const overlap = (minDist - dist) * 0.5;
      const angle = Math.atan2(dy, dx);
      const finalAngle = dist === 0 ? Math.random() * Math.PI * 2 : angle;
      const moveX = Math.cos(finalAngle) * overlap;
      const moveY = Math.sin(finalAngle) * overlap;

      const e1Weight = e1.type === 'THOR' ? 0.9 : 0.5;
      const e2Weight = 1 - e1Weight;

      e1.pos.x += moveX * e1Weight;
      e1.pos.y += moveY * e1Weight;
      e2.pos.x -= moveX * e2Weight;
      e2.pos.y -= moveY * e2Weight;
    }
  };

  const resolveBushCollision = (entity: Entity, bush: Bush) => {
    if (entity.type === 'HUMAN') {
      const h = humansRef.current.find(h => h.id === entity.id);
      if (h?.isHiding && h.targetBush === bush) return;
    }
    const dx = entity.pos.x - bush.pos.x;
    const dy = entity.pos.y - bush.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = entity.radius + bush.radius * 0.7;
    if (dist < minDist) {
      const overlap = minDist - dist;
      const angle = Math.atan2(dy, dx);
      entity.pos.x += Math.cos(angle) * overlap;
      entity.pos.y += Math.sin(angle) * overlap;
    }
  };

  const startGame = () => {
    thorRef.current = { ...thorRef.current, pos: { x: 100, y: WORLD_HEIGHT / 2 }, isDead: false, attackFrame: 0, barkFrame: 0 };
    humansRef.current = humansRef.current.map((h, i) => ({
      ...h,
      pos: { x: 60, y: WORLD_HEIGHT / 2 + (i === 0 ? -25 : 25) },
      health: 100,
      isHiding: false,
      targetBush: null
    }));
    enemiesRef.current = [];
    particlesRef.current = [];
    hidingTimerRef.current = null;
    setHidingTimeLeft(0);
    setGameState({ status: 'PLAYING', score: 0, distanceCovered: 0 });
    playSound(440, 0.3, 'sine', 0.15);
    fetchThorThought("¡Bienvenidos al bosque! Yo los cuidaré.");
  };

  const fetchThorThought = async (context: string) => {
    const now = Date.now();
    if (now - lastThoughtTime.current < 6000) return;
    lastThoughtTime.current = now;
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Eres Thor, un perro guardián inmortal. Contexto: ${context}. Responde con un pensamiento corto, valiente y de perro protector (máximo 8 palabras).`,
      });
      if (response.text) aiThoughtRef.current = response.text.trim();
    } catch (e) { aiThoughtRef.current = "¡Soy el escudo de esta familia!"; }
  };

  const update = useCallback(() => {
    if (gameState.status !== 'PLAYING') return;

    const thor = thorRef.current;
    const humans = humansRef.current;
    const enemies = enemiesRef.current;
    const bushes = bushesRef.current;

    // Movement Thor (Keys + Touch)
    let dx = 0, dy = 0;
    if (keysPressed.current.has('ArrowUp') || keysPressed.current.has('w') || touchDirections.current.up) dy -= 1;
    if (keysPressed.current.has('ArrowDown') || keysPressed.current.has('s') || touchDirections.current.down) dy += 1;
    if (keysPressed.current.has('ArrowLeft') || keysPressed.current.has('a') || touchDirections.current.left) dx -= 1;
    if (keysPressed.current.has('ArrowRight') || keysPressed.current.has('d') || touchDirections.current.right) dx += 1;

    if (dx !== 0 || dy !== 0) {
      const mag = Math.sqrt(dx * dx + dy * dy);
      thor.pos.x += (dx / mag) * thor.speed;
      thor.pos.y += (dy / mag) * thor.speed;
      thor.angle = Math.atan2(dy, dx);
      if (Math.random() < 0.1) createParticles(thor.pos.x, thor.pos.y + 10, 'rgba(255,255,255,0.1)', 1, 1);
    }

    thor.pos.x = Math.max(thor.radius, Math.min(WORLD_WIDTH - thor.radius, thor.pos.x));
    thor.pos.y = Math.max(thor.radius, Math.min(WORLD_HEIGHT - thor.radius, thor.pos.y));

    const now = Date.now();

    // Bark Mechanic (Tecla E or Touch)
    if ((keysPressed.current.has('e') || keysPressed.current.has('E') || touchActions.current.bark) && now - thor.lastBarkTime > 1000) {
      thor.barkFrame = 20;
      thor.lastBarkTime = now;
      playBarkSound();
      fetchThorThought("¡ALÉJENSE! *Guau*");
      touchActions.current.bark = false; // Reset touch action

      enemies.forEach(enemy => {
        const d = Math.sqrt(Math.pow(enemy.pos.x - thor.pos.x, 2) + Math.pow(enemy.pos.y - thor.pos.y, 2));
        const barkRange = 180;
        if (d < barkRange) {
          const pushAngle = Math.atan2(enemy.pos.y - thor.pos.y, enemy.pos.x - thor.pos.x);
          const pushForce = (1 - d / barkRange) * 60;
          enemy.pos.x += Math.cos(pushAngle) * pushForce;
          enemy.pos.y += Math.sin(pushAngle) * pushForce;
          enemy.hitFrame = 5;
          createParticles(enemy.pos.x, enemy.pos.y, 'rgba(255,255,255,0.5)', 3, 2);
        }
      });
    }
    if (thor.barkFrame > 0) thor.barkFrame--;

    // Attack Mechanic (Space or Touch)
    if ((keysPressed.current.has(' ') || touchActions.current.attack) && now - thor.lastAttackTime > 350) {
      thor.attackFrame = 12;
      thor.lastAttackTime = now;
      playSound(200, 0.15, 'square', 0.1);
      createParticles(thor.pos.x + Math.cos(thor.angle) * 30, thor.pos.y + Math.sin(thor.angle) * 30, '#FFF', 5, 2);
      touchActions.current.attack = false; // Reset touch action
      
      enemies.forEach(enemy => {
        const d = Math.sqrt(Math.pow(enemy.pos.x - thor.pos.x, 2) + Math.pow(enemy.pos.y - thor.pos.y, 2));
        if (d < thor.radius + enemy.radius + 40) {
          enemy.health -= 25;
          enemy.hitFrame = 8;
          createParticles(enemy.pos.x, enemy.pos.y, COLORS.DOG, 10, 5);
          if (enemy.health <= 0) {
            enemy.isDead = true;
            setGameState(prev => ({ ...prev, score: prev.score + 250 }));
          }
        }
      });
    }
    if (thor.attackFrame > 0) thor.attackFrame--;

    // Toggle Hiding (F Key or Touch)
    if (keysPressed.current.has('f') || keysPressed.current.has('F') || touchActions.current.hide) {
      keysPressed.current.delete('f');
      keysPressed.current.delete('F');
      touchActions.current.hide = false; // Reset touch action

      const shouldHide = !humans[0].isHiding;
      playSound(shouldHide ? 400 : 250, 0.2, 'sine', 0.1);
      
      if (shouldHide) {
        hidingTimerRef.current = Date.now();
        setHidingTimeLeft(10);
        humans.forEach(h => {
          h.isHiding = true;
          let nearest: Bush | null = null;
          let minDist = Infinity;
          bushes.forEach(b => {
            const d = Math.sqrt(Math.pow(h.pos.x - b.pos.x, 2) + Math.pow(h.pos.y - b.pos.y, 2));
            if (d < minDist) { minDist = d; nearest = b; }
          });
          h.targetBush = nearest;
        });
      } else {
        hidingTimerRef.current = null;
        setHidingTimeLeft(0);
        humans.forEach(h => { h.isHiding = false; h.targetBush = null; });
      }
    }

    // Timer logic
    if (hidingTimerRef.current) {
      const elapsed = (Date.now() - hidingTimerRef.current) / 1000;
      setHidingTimeLeft(Math.max(0, 10 - elapsed));
      if (elapsed >= 10) {
        hidingTimerRef.current = null;
        setHidingTimeLeft(0);
        humans.forEach(h => { h.isHiding = false; h.targetBush = null; });
      }
    }

    // Humans logic
    humans.forEach((h) => {
      let targetPos = thor.pos;
      if (h.isHiding && h.targetBush) targetPos = h.targetBush.pos;
      const dist = Math.sqrt(Math.pow(targetPos.x - h.pos.x, 2) + Math.pow(targetPos.y - h.pos.y, 2));
      const threshold = h.isHiding ? 5 : 85;
      if (dist > threshold) {
        const angle = Math.atan2(targetPos.y - h.pos.y, targetPos.x - h.pos.x);
        h.pos.x += Math.cos(angle) * h.speed;
        h.pos.y += Math.sin(angle) * h.speed;
        h.angle = angle;
      }
    });

    // Enemy Spawning
    if (Math.random() < 0.025) {
      const spawnX = thor.pos.x + VIEWPORT_WIDTH / 1.5 + Math.random() * 500;
      const spawnY = Math.random() * WORLD_HEIGHT;
      const type = ['WOLF', 'DOG', 'CRIMINAL'][Math.floor(Math.random() * 3)] as any;
      enemies.push({
        id: Math.random().toString(),
        type, pos: { x: spawnX, y: spawnY }, velocity: { x: 0, y: 0 },
        health: 50, maxHealth: 50, radius: ENTITY_RADIUS[type], speed: SPEEDS[type],
        isDead: false, angle: 0, hitFrame: 0
      });
    }

    // Enemies update
    enemies.forEach((enemy) => {
      const visibleHumans = humans.filter(h => {
        if (!h.isHiding || !h.targetBush) return true;
        const d = Math.sqrt(Math.pow(h.pos.x - h.targetBush.pos.x, 2) + Math.pow(h.pos.y - h.targetBush.pos.y, 2));
        return d > h.targetBush.radius * 0.5;
      });

      let target: Entity = thor;
      let minDist = Infinity;

      if (visibleHumans.length > 0) {
        visibleHumans.forEach(h => {
          const d = Math.sqrt(Math.pow(enemy.pos.x - h.pos.x, 2) + Math.pow(enemy.pos.y - h.pos.y, 2));
          if (d < minDist) { minDist = d; target = h; }
        });
      } else {
        const d = Math.sqrt(Math.pow(enemy.pos.x - thor.pos.x, 2) + Math.pow(enemy.pos.y - thor.pos.y, 2));
        minDist = d; target = thor;
      }

      const angle = Math.atan2(target.pos.y - enemy.pos.y, target.pos.x - enemy.pos.x);
      enemy.pos.x += Math.cos(angle) * enemy.speed;
      enemy.pos.y += Math.sin(angle) * enemy.speed;
      enemy.angle = angle;

      if (minDist < enemy.radius + target.radius && target.type === 'HUMAN') {
        target.health -= 0.6;
        if (target.health <= 0) {
          setGameState(prev => ({ ...prev, status: 'LOST' }));
          playSound(100, 0.5, 'sawtooth', 0.2);
        }
      }
      if (enemy.hitFrame > 0) enemy.hitFrame--;
    });

    // COLLISIONS
    bushes.forEach(bush => {
      resolveBushCollision(thor, bush);
      humans.forEach(h => resolveBushCollision(h, bush));
      enemies.forEach(e => resolveBushCollision(e, bush));
    });
    enemies.forEach(enemy => resolveCollision(thor, enemy));
    enemies.forEach(enemy => humans.forEach(human => resolveCollision(human, enemy)));
    for (let i = 0; i < enemies.length; i++) {
      for (let j = i + 1; j < enemies.length; j++) resolveCollision(enemies[i], enemies[j]);
    }

    particlesRef.current.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.life -= 0.025;
    });
    particlesRef.current = particlesRef.current.filter(p => p.life > 0);

    enemiesRef.current = enemies.filter(e => !e.isDead && e.pos.x > thor.pos.x - VIEWPORT_WIDTH);
    cameraX.current = Math.max(0, Math.min(WORLD_WIDTH - VIEWPORT_WIDTH, thor.pos.x - VIEWPORT_WIDTH / 3));

    if (thor.pos.x >= WORLD_WIDTH - 300) {
      setGameState(prev => ({ ...prev, status: 'WON' }));
      playSound(523.25, 0.5, 'sine', 0.2);
    }
    setGameState(prev => ({ ...prev, distanceCovered: Math.floor((thor.pos.x / WORLD_WIDTH) * 100) }));
  }, [gameState.status]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    const camX = cameraX.current;

    const bgGrad = ctx.createLinearGradient(0, 0, 0, VIEWPORT_HEIGHT);
    bgGrad.addColorStop(0, '#0F172A');
    bgGrad.addColorStop(1, '#020617');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

    ctx.fillStyle = 'rgba(16, 185, 129, 0.1)';
    grassTuftsRef.current.forEach(t => {
      const tx = t.x - camX;
      if (tx < -20 || tx > VIEWPORT_WIDTH + 20) return;
      ctx.fillRect(tx, t.y, t.w, t.h);
    });

    bushesRef.current.forEach(bush => {
      const bx = bush.pos.x - camX;
      if (bx < -200 || bx > VIEWPORT_WIDTH + 200) return;
      ctx.save();
      ctx.translate(bx, bush.pos.y);
      ctx.rotate(bush.rotation);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(5, 5, bush.radius, bush.radius * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.MATORRAL;
      ctx.beginPath();
      ctx.arc(0, 0, bush.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.MATORRAL_LIGHT;
      bush.leaves.forEach(l => {
        ctx.beginPath();
        ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    });

    particlesRef.current.forEach(p => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x - camX, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    const drawEntity = (e: any) => {
      const ex = e.pos.x - camX;
      if (e.type === 'THOR' || e.type === 'HOUSE') {
        const glowRadius = e.type === 'THOR' ? 100 : 250;
        const glow = ctx.createRadialGradient(ex, e.pos.y, 0, ex, e.pos.y, glowRadius);
        glow.addColorStop(0, e.type === 'THOR' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(253, 224, 71, 0.1)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(ex, e.pos.y, glowRadius, 0, Math.PI*2); ctx.fill();
      }
      if (e.type === 'THOR' && e.barkFrame > 0) {
        const ringRadius = (1 - e.barkFrame / 20) * 180;
        ctx.strokeStyle = `rgba(255, 255, 255, ${e.barkFrame / 20})`;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(ex, e.pos.y, ringRadius, 0, Math.PI * 2); ctx.stroke();
      }
      if (e.type === 'HUMAN' && e.isHiding && e.targetBush) {
        const d = Math.sqrt(Math.pow(e.pos.x - e.targetBush.pos.x, 2) + Math.pow(e.pos.y - e.targetBush.pos.y, 2));
        if (d < e.targetBush.radius * 0.6) ctx.globalAlpha = 0.2;
      }
      ctx.save();
      ctx.translate(ex, e.pos.y);
      ctx.rotate(e.angle);
      if (e.hitFrame > 0) ctx.filter = 'brightness(3) saturate(2)';
      ctx.fillStyle = COLORS[e.type as keyof typeof COLORS] || '#FFF';
      if (e.type === 'THOR') {
        const s = 1 + (e.attackFrame / 15) + (e.barkFrame / 30);
        ctx.scale(s, s);
        ctx.fillRect(-e.radius, -e.radius/1.8, e.radius * 2, e.radius);
        ctx.fillRect(e.radius - 5, -e.radius/1.4, e.radius * 0.8, e.radius * 0.8);
        ctx.fillStyle = '#B45309';
        ctx.fillRect(e.radius - 8, -e.radius/1.4 - 5, 6, 8);
        ctx.fillRect(-e.radius - 8, -2, 10, 4);
        ctx.fillStyle = '#000';
        ctx.fillRect(e.radius + 2, -e.radius/1.8, 3, 3);
        if (e.attackFrame > 0) {
          ctx.strokeStyle = `rgba(255,255,255,${e.attackFrame/12})`;
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(e.radius + 10, 0, 25, -0.5, 0.5); ctx.stroke();
        }
      } else if (e.type === 'HUMAN') {
        ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#FCA5A5';
        ctx.beginPath(); ctx.arc(e.radius/2, 0, e.radius/2, 0, Math.PI*2); ctx.fill();
      } else {
        ctx.fillStyle = COLORS[e.type as keyof typeof COLORS];
        ctx.beginPath();
        ctx.moveTo(e.radius, 0); ctx.lineTo(-e.radius, e.radius); ctx.lineTo(-e.radius/2, 0); ctx.lineTo(-e.radius, -e.radius);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#EF4444';
        ctx.beginPath(); ctx.arc(e.radius - 5, -3, 2, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(e.radius - 5, 3, 2, 0, Math.PI*2); ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1.0;
      ctx.filter = 'none';
      if (e.type !== 'HOUSE' && e.type !== 'THOR') {
        const barW = 40;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.roundRect(ex - barW/2, e.pos.y - e.radius - 18, barW, 6, 3); ctx.fill();
        const hpPerc = Math.max(0, e.health) / (e.maxHealth || 100);
        ctx.fillStyle = hpPerc > 0.3 ? '#10B981' : '#EF4444';
        ctx.roundRect(ex - barW/2 + 1, e.pos.y - e.radius - 17, (barW-2) * hpPerc, 4, 2); ctx.fill();
      }
    };

    const houseX = WORLD_WIDTH - 250 - camX;
    if (houseX > -200 && houseX < VIEWPORT_WIDTH + 200) {
      ctx.fillStyle = '#92400E'; ctx.fillRect(houseX, WORLD_HEIGHT/2 - 70, 100, 100);
      ctx.fillStyle = '#7F1D1D'; ctx.beginPath(); ctx.moveTo(houseX - 10, WORLD_HEIGHT/2 - 70); ctx.lineTo(houseX + 50, WORLD_HEIGHT/2 - 120); ctx.lineTo(houseX + 110, WORLD_HEIGHT/2 - 70); ctx.fill();
      ctx.fillStyle = COLORS.HOUSE; ctx.fillRect(houseX + 40, WORLD_HEIGHT/2 - 20, 20, 20);
    }

    humansRef.current.forEach(drawEntity);
    enemiesRef.current.forEach(drawEntity);
    drawEntity(thorRef.current);

    const vig = ctx.createRadialGradient(VIEWPORT_WIDTH/2, VIEWPORT_HEIGHT/2, VIEWPORT_WIDTH/4, VIEWPORT_WIDTH/2, VIEWPORT_HEIGHT/2, VIEWPORT_WIDTH/1.2);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = vig; ctx.fillRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

    requestRef.current = requestAnimationFrame(() => {
      update();
      draw();
    });
  }, [update]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => keysPressed.current.add(e.key);
    const handleKeyUp = (e: KeyboardEvent) => keysPressed.current.delete(e.key);
    const checkTouch = () => setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    checkTouch();
    requestRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [draw]);

  return (
    <div className="relative w-full h-screen bg-slate-950 flex items-center justify-center overflow-hidden text-white font-sans selection:bg-amber-500">
      
      {/* HUD High Quality */}
      {gameState.status === 'PLAYING' && (
        <div className="absolute top-4 left-4 right-4 md:top-8 md:left-8 md:right-8 flex justify-between items-start pointer-events-none z-10 scale-75 md:scale-100 origin-top">
          <div className="bg-slate-900/60 backdrop-blur-xl p-4 md:p-6 rounded-3xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex gap-4 md:gap-6 items-center">
            <div className="w-12 h-12 md:w-16 md:h-16 bg-amber-500 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/20">
              <i className="fas fa-dog text-2xl md:text-3xl text-slate-900"></i>
            </div>
            <div className="space-y-1.5 md:space-y-3">
              <div className="flex items-center gap-3">
                <h2 className="text-lg md:text-xl font-black tracking-tighter uppercase italic">Thor</h2>
                <span className="bg-amber-500/20 text-amber-400 text-[8px] md:text-[10px] px-2 py-0.5 rounded-full font-bold border border-amber-500/30">ESCUDO ETERNO</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-end">
                  <span className="text-[8px] md:text-[10px] text-slate-400 font-bold uppercase tracking-widest">Familia</span>
                  <span className="text-[10px] md:text-xs font-black text-blue-400">{Math.ceil((humansRef.current[0].health + humansRef.current[1].health) / 2)}%</span>
                </div>
                <div className="w-40 md:w-64 h-2 bg-slate-800 rounded-full overflow-hidden p-0.5">
                  <div className="h-full bg-gradient-to-r from-blue-600 via-cyan-400 to-blue-500 rounded-full transition-all duration-300" 
                       style={{ width: `${(humansRef.current[0].health + humansRef.current[1].health) / 2}%` }} />
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2 md:gap-4">
            {hidingTimeLeft > 0 && (
              <div className="bg-emerald-500/90 backdrop-blur-lg px-4 py-2 md:px-6 md:py-4 rounded-2xl border border-emerald-400/50 shadow-xl animate-bounce">
                <div className="flex items-center gap-2 md:gap-3 text-emerald-950">
                  <i className="fas fa-eye-slash text-base md:text-xl"></i>
                  <span className="text-sm md:text-lg font-black">{hidingTimeLeft.toFixed(1)}s</span>
                </div>
              </div>
            )}
            
            <div className="bg-slate-900/60 backdrop-blur-xl p-3 md:p-5 rounded-2xl border border-white/10 shadow-xl text-right">
              <p className="text-[8px] md:text-[10px] text-slate-500 font-black tracking-widest uppercase mb-1">Honor</p>
              <p className="text-2xl md:text-4xl font-black tracking-tighter">{gameState.score.toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}

      {/* Thor AI Thought Bubble */}
      {gameState.status === 'PLAYING' && (
        <div className="absolute bottom-24 md:bottom-16 left-1/2 -translate-x-1/2 z-20 pointer-events-none group px-4 w-full max-w-sm">
          <div className="bg-white/95 text-slate-900 px-6 py-3 md:px-10 md:py-5 rounded-[2rem] md:rounded-[2.5rem] relative shadow-[0_25px_60px_rgba(0,0,0,0.4)] font-black text-sm md:text-xl text-center border-2 md:border-4 border-amber-400 transition-transform group-hover:scale-105">
            <span className="bg-clip-text text-transparent bg-gradient-to-br from-slate-900 to-slate-600 italic">
              "{aiThoughtRef.current}"
            </span>
            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-6 h-6 bg-white rotate-45 border-r-2 md:border-r-4 border-b-2 md:border-b-4 border-amber-400"></div>
          </div>
        </div>
      )}

      {/* Game Canvas */}
      <div className="relative p-1 bg-slate-800 rounded-2xl md:rounded-3xl shadow-[0_0_100px_rgba(0,0,0,0.8)] w-full max-w-[1200px] mx-4 aspect-[2/1]">
        <div className="relative overflow-hidden rounded-xl md:rounded-[1.25rem] bg-black w-full h-full">
          <canvas ref={canvasRef} width={VIEWPORT_WIDTH} height={VIEWPORT_HEIGHT} className="w-full h-full object-contain cursor-none" />
          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-white/5">
            <div className="h-full bg-gradient-to-r from-amber-500 to-yellow-300 shadow-[0_0_15px_rgba(245,158,11,0.5)] transition-all duration-700" 
                 style={{ width: `${gameState.distanceCovered}%` }} />
          </div>
        </div>
      </div>

      {/* TOUCH CONTROLS (Only visible on touch devices) */}
      {gameState.status === 'PLAYING' && isTouchDevice && (
        <div className="absolute inset-0 pointer-events-none z-30">
          {/* D-PAD (Cruceta) */}
          <div className="absolute bottom-8 left-8 w-40 h-40 bg-white/5 backdrop-blur-md rounded-full border border-white/10 pointer-events-auto flex items-center justify-center">
            <div className="grid grid-cols-3 grid-rows-3 gap-1">
              <div />
              <button 
                onPointerDown={() => touchDirections.current.up = true} 
                onPointerUp={() => touchDirections.current.up = false}
                onPointerLeave={() => touchDirections.current.up = false}
                className="w-12 h-12 bg-white/20 rounded flex items-center justify-center active:bg-amber-500 active:text-slate-900"
              ><i className="fas fa-caret-up text-2xl" /></button>
              <div />
              <button 
                onPointerDown={() => touchDirections.current.left = true} 
                onPointerUp={() => touchDirections.current.left = false}
                onPointerLeave={() => touchDirections.current.left = false}
                className="w-12 h-12 bg-white/20 rounded flex items-center justify-center active:bg-amber-500 active:text-slate-900"
              ><i className="fas fa-caret-left text-2xl" /></button>
              <div className="w-12 h-12" />
              <button 
                onPointerDown={() => touchDirections.current.right = true} 
                onPointerUp={() => touchDirections.current.right = false}
                onPointerLeave={() => touchDirections.current.right = false}
                className="w-12 h-12 bg-white/20 rounded flex items-center justify-center active:bg-amber-500 active:text-slate-900"
              ><i className="fas fa-caret-right text-2xl" /></button>
              <div />
              <button 
                onPointerDown={() => touchDirections.current.down = true} 
                onPointerUp={() => touchDirections.current.down = false}
                onPointerLeave={() => touchDirections.current.down = false}
                className="w-12 h-12 bg-white/20 rounded flex items-center justify-center active:bg-amber-500 active:text-slate-900"
              ><i className="fas fa-caret-down text-2xl" /></button>
              <div />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="absolute bottom-8 right-8 pointer-events-auto flex flex-col gap-4 items-end">
            <div className="flex gap-4">
              <button 
                onPointerDown={() => touchActions.current.bark = true}
                className="w-16 h-16 bg-blue-500/80 backdrop-blur-md rounded-full border border-white/20 flex items-center justify-center active:scale-90 active:bg-blue-400"
              >
                <i className="fas fa-bullhorn text-2xl" />
              </button>
              <button 
                onPointerDown={() => touchActions.current.hide = true}
                className="w-16 h-16 bg-emerald-500/80 backdrop-blur-md rounded-full border border-white/20 flex items-center justify-center active:scale-90 active:bg-emerald-400"
              >
                <i className="fas fa-eye-slash text-2xl" />
              </button>
            </div>
            <button 
              onPointerDown={() => touchActions.current.attack = true}
              className="w-24 h-24 bg-red-500/80 backdrop-blur-md rounded-full border border-white/20 flex items-center justify-center active:scale-90 active:bg-red-400 shadow-xl shadow-red-500/20"
            >
              <i className="fas fa-paw text-4xl" />
            </button>
          </div>
        </div>
      )}

      {/* Desktop Key Legend */}
      {gameState.status === 'PLAYING' && !isTouchDevice && (
        <div className="absolute bottom-8 right-8 flex gap-6 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
          <div className="flex items-center gap-2"><span className="bg-slate-800 text-white px-2 py-1 rounded">WASD</span> Caminar</div>
          <div className="flex items-center gap-2"><span className="bg-slate-800 text-white px-2 py-1 rounded">SPACE</span> Morder</div>
          <div className="flex items-center gap-2"><span className="bg-slate-800 text-white px-2 py-1 rounded">E</span> Ladrar</div>
          <div className="flex items-center gap-2"><span className="bg-slate-800 text-white px-2 py-1 rounded">F</span> Esconder</div>
        </div>
      )}

      {/* Start Screen */}
      {gameState.status === 'START' && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm flex flex-col items-center justify-center z-50 p-6 md:p-12 text-center animate-in fade-in duration-700 overflow-y-auto">
          <div className="relative mb-8 md:mb-16 shrink-0">
            <div className="absolute -inset-6 md:-inset-10 bg-amber-500/20 blur-3xl rounded-full animate-pulse"></div>
            <h1 className="text-6xl md:text-[10rem] font-black text-white tracking-tighter leading-none select-none drop-shadow-2xl">THOR</h1>
            <p className="text-amber-500 font-black text-lg md:text-3xl uppercase tracking-[0.2em] md:tracking-[0.4em] italic mt-2">Guardian de las Sombras</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 max-w-7xl mb-12 md:mb-20">
            {[
              { icon: 'shield-dog', color: 'text-amber-400', title: 'Inmortal', desc: 'Thor no puede morir.' },
              { icon: 'leaf', color: 'text-emerald-400', title: 'Sigilo', desc: 'Esconde a la familia 10s.' },
              { icon: 'bullhorn', color: 'text-blue-400', title: 'Ladrido', desc: 'Empuja a tus enemigos.' },
              { icon: 'skull', color: 'text-red-400', title: 'Peligro', desc: 'Protege a los humanos.' }
            ].map((feature, i) => (
              <div key={i} className="bg-white/5 p-4 md:p-6 rounded-2xl md:rounded-[2rem] border border-white/10 hover:bg-white/10 transition-all group">
                <i className={`fas fa-${feature.icon} ${feature.color} text-xl md:text-3xl mb-2 md:mb-4 group-hover:scale-110 transition-transform`}></i>
                <h3 className="font-black text-sm md:text-xl mb-1 md:mb-2 uppercase tracking-tight">{feature.title}</h3>
                <p className="text-slate-400 leading-relaxed text-[10px] md:text-xs font-medium">{feature.desc}</p>
              </div>
            ))}
          </div>

          <button 
            onClick={startGame}
            className="group relative px-12 py-6 md:px-20 md:py-8 bg-amber-500 text-slate-950 text-2xl md:text-4xl font-black rounded-full transition-all hover:scale-105 active:scale-95 hover:shadow-[0_0_80px_rgba(245,158,11,0.5)] overflow-hidden shrink-0"
          >
            <span className="relative z-10 uppercase tracking-tighter">Comenzar Guardia</span>
          </button>
        </div>
      )}

      {/* Loss/Win screens simplified for high quality */}
      {gameState.status === 'LOST' && (
        <div className="absolute inset-0 bg-red-950/95 backdrop-blur-md flex flex-col items-center justify-center z-50 text-center animate-in zoom-in duration-500 p-6">
          <h2 className="text-5xl md:text-9xl font-black text-white mb-6 tracking-tighter uppercase">Caído en Deber</h2>
          <p className="text-lg md:text-2xl text-red-200/50 mb-12 max-w-2xl font-bold italic">"El bosque reclamó a los débiles. Thor ahora camina solo en la eternidad."</p>
          <button onClick={startGame} className="px-12 py-4 md:px-16 md:py-6 bg-white text-red-950 text-xl md:text-2xl font-black rounded-full hover:scale-105 transition-all">Reintentar</button>
        </div>
      )}

      {gameState.status === 'WON' && (
        <div className="absolute inset-0 bg-emerald-950/95 backdrop-blur-md flex flex-col items-center justify-center z-50 text-center animate-in zoom-in duration-500 p-6">
          <i className="fas fa-home text-6xl md:text-9xl text-emerald-400 mb-8 md:mb-12"></i>
          <h2 className="text-6xl md:text-9xl font-black text-white mb-6 tracking-tighter uppercase">A Salvo</h2>
          <div className="bg-black/40 px-8 py-4 md:px-12 md:py-8 rounded-[2rem] md:rounded-[3rem] border border-white/5 mb-12">
             <p className="text-slate-400 text-xs md:text-sm font-black uppercase tracking-widest mb-2">Puntos de Honor</p>
             <p className="text-4xl md:text-7xl font-black text-emerald-400">{gameState.score.toLocaleString()}</p>
          </div>
          <button onClick={startGame} className="px-12 py-4 md:px-16 md:py-6 bg-emerald-500 text-slate-950 text-xl md:text-2xl font-black rounded-full hover:scale-105 transition-all">Nueva Guardia</button>
        </div>
      )}

    </div>
  );
};

export default App;
