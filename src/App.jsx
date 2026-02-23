import React, { useState, useEffect } from 'react';
import { 
  Users, 
  TrendingUp, 
  Wallet, 
  AlertCircle, 
  ChevronRight, 
  Trophy, 
  RotateCcw, 
  CheckCircle2, 
  Clock, 
  Smartphone, 
  Plus, 
  Eye, 
  EyeOff,
  BarChart3,
  ShieldCheck
} from 'lucide-react';

// --- IMPORTACIONES DE FIREBASE ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, updateDoc } from 'firebase/firestore';

// --- CONFIGURACIÓN GLOBAL ---
const TOTAL_ROUNDS = 5;
const INITIAL_TOKENS = 10;

// Utilidades de seguridad para prevenir el error de "Pantalla Blanca" en React
const safeNum = (num) => Number(num) || 0;
const safeScore = (score) => safeNum(score).toFixed(1);

// Colores corporativos para los equipos
const TEAM_COLORS = [
  'bg-blue-500', 'bg-orange-500', 'bg-purple-500', 'bg-teal-500', 
  'bg-pink-500', 'bg-red-500', 'bg-green-500', 'bg-indigo-500', 'bg-yellow-500'
];

// Estado inicial del juego
const defaultGameState = {
  status: 'setup', // setup, playing, reveal, end, waiting_host
  currentRound: 1,
  teams: [], 
  currentInputs: {}, 
  inputStatus: {}, 
  roundResult: null,
  history: []
};

// --- INICIALIZACIÓN DE FIREBASE BLINDADA ---
let app, auth, db, appId;

// Función de extracción segura para evitar errores de entorno en navegadores/StackBlitz
const getSafeApiKey = () => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_FIREBASE_API_KEY) {
      return import.meta.env.VITE_FIREBASE_API_KEY;
    }
  } catch (e) {}
  return "AIzaSyC1MTCPfK9T062TkG_L1YgOs47qoJwWTH8"; // Clave de respaldo
};

try {
  const firebaseConfig = {
    apiKey: getSafeApiKey(),
    authDomain: "sinergia-corp.firebaseapp.com",
    projectId: "sinergia-corp",
    storageBucket: "sinergia-corp.firebasestorage.app",
    messagingSenderId: "90347983031",
    appId: "1:90347983031:web:35726071306234c9dcbd32",
    measurementId: "G-T7PXEJCPQ4"
  };
  
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  appId = 'sinergia-corp-taller-final-v3'; // ID de sesión único para el taller
} catch (e) {
  console.error("Error crítico al iniciar Firebase:", e);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [role, setRole] = useState(null); // 'none', 'facilitator', 'player_select', 'player'
  const [teamId, setTeamId] = useState(null);
  const [gameData, setGameData] = useState(null);
  const [playerInput, setPlayerInput] = useState(0);
  const [joinName, setJoinName] = useState('');

  // 1. Autenticación Anónima Segura
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        setAuthError("No se pudo conectar al servidor de Sinergia.");
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. Sincronización en Tiempo Real con Firestore
  useEffect(() => {
    if (!user || !db) return;
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'game_session', 'main');
    
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setGameData(docSnap.data());
      } else if (role === 'facilitator') {
        setDoc(docRef, defaultGameState);
      } else {
        setGameData({ status: 'waiting_host', teams: [] });
      }
    }, (err) => console.error("Error de Sincronización:", err));
    
    return () => unsubscribe();
  }, [user, role]);

  // Si el facilitador reinicia, sacamos a los jugadores a la pantalla de selección
  useEffect(() => {
    if (role === 'player' && gameData?.status === 'setup' && teamId) {
      const teamExists = (gameData.teams || []).some(t => t.id === teamId);
      if (!teamExists) {
        setRole(null);
        setTeamId(null);
      }
    }
  }, [gameData, role, teamId]);

  const getDocRef = () => doc(db, 'artifacts', appId, 'public', 'data', 'game_session', 'main');

  // --- ACCIONES: FACILITADOR ---
  const handleFacilitatorStart = async () => {
    setRole('facilitator');
    await setDoc(getDocRef(), defaultGameState, { merge: true });
  };

  const startGame = async () => {
    await updateDoc(getDocRef(), { 
      status: 'playing', 
      currentRound: 1, 
      currentInputs: {}, 
      inputStatus: {},
      roundResult: null
    });
  };

  const calculateRound = async () => {
    if (!gameData) return;
    let totalInvested = 0;
    const playerDetails = [];
    const multiplier = gameData.currentRound === 5 ? 3 : 2;

    (gameData.teams || []).forEach(team => {
      const invested = safeNum(gameData.currentInputs?.[team.id]);
      totalInvested += invested;
      playerDetails.push({ ...team, invested, kept: INITIAL_TOKENS - invested });
    });

    const multipliedFund = totalInvested * multiplier;
    const payoutPerTeam = multipliedFund / Math.max(1, (gameData.teams || []).length);

    const updatedTeams = (gameData.teams || []).map(team => {
      const invested = safeNum(gameData.currentInputs?.[team.id]);
      const roundEarned = (INITIAL_TOKENS - invested) + payoutPerTeam;
      return { ...team, score: safeNum(team.score) + roundEarned };
    });

    await updateDoc(getDocRef(), {
      teams: updatedTeams,
      roundResult: { totalInvested, multipliedFund, payoutPerTeam, details: playerDetails },
      history: [...(gameData.history || []), { round: gameData.currentRound, totalInvested }],
      status: 'reveal'
    });
  };

  const nextRound = async () => {
    if (gameData.currentRound >= TOTAL_ROUNDS) {
      await updateDoc(getDocRef(), { status: 'end' });
    } else {
      await updateDoc(getDocRef(), {
        currentRound: gameData.currentRound + 1,
        status: 'playing',
        inputStatus: {},
        currentInputs: {},
        roundResult: null
      });
      setPlayerInput(0);
    }
  };

  const resetGame = () => setDoc(getDocRef(), defaultGameState);

  // --- ACCIONES: JUGADOR ---
  const joinAsTeam = async (e) => {
    e.preventDefault();
    if (!joinName.trim() || !gameData) return;
    const newId = 'team_' + Math.random().toString(36).substr(2, 9);
    const newTeam = { 
      id: newId, 
      name: joinName.trim(), 
      color: TEAM_COLORS[(gameData.teams || []).length % TEAM_COLORS.length], 
      score: 0 
    };
    await updateDoc(getDocRef(), {
      teams: [...(gameData.teams || []), newTeam]
    });
    setTeamId(newId);
    setRole('player');
  };

  const submitPlayerDecision = async () => {
    if (!gameData || !teamId) return;
    const val = Math.max(0, Math.min(INITIAL_TOKENS, Number(playerInput) || 0));
    
    const updates = {};
    updates[`currentInputs.${teamId}`] = val;
    updates[`inputStatus.${teamId}`] = true;
    
    try {
      await updateDoc(getDocRef(), updates);
    } catch (e) {
      console.error("Error al enviar decisión:", e);
    }
  };

  // --- COMPONENTES DE INTERFAZ ---

  if (authError) return <div className="min-h-screen bg-[#0B132B] flex items-center justify-center p-8 text-white text-center font-sans"><div className="bg-red-500/10 p-10 rounded-3xl border border-red-500/50"><AlertCircle size={48} className="mx-auto mb-4 text-red-500" />{authError}</div></div>;
  if (!user) return <div className="min-h-screen bg-[#0B132B] flex items-center justify-center text-white font-sans animate-pulse text-xl tracking-[0.3em] uppercase">Iniciando Sinergia...</div>;

  if (!role) {
    return (
      <div className="min-h-screen bg-[#0B132B] text-white p-4 md:p-8 flex flex-col items-center justify-center font-sans">
        <TrendingUp size={80} className="text-orange-500 mb-6 drop-shadow-[0_0_15px_rgba(255,91,34,0.4)]" />
        <h1 className="text-6xl font-black mb-2 tracking-tighter text-center italic">SINERGIA <span className="text-orange-500">CORP</span></h1>
        <p className="text-gray-400 mb-12 uppercase tracking-[0.4em] text-xs">Simulador de Cooperación Estratégica</p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl">
          <button onClick={handleFacilitatorStart} className="bg-[#1A1B41] p-12 rounded-[40px] border border-[#2E3192] hover:border-orange-500 transition-all flex flex-col items-center gap-6 group shadow-2xl">
            <Users size={56} className="text-orange-500 group-hover:scale-110 transition-transform" />
            <div className="text-center">
              <h2 className="text-3xl font-black mb-2">FACILITADOR</h2>
              <p className="text-gray-500 text-xs uppercase tracking-widest">Panel de Control</p>
            </div>
          </button>
          <button onClick={() => setRole('player_select')} className="bg-[#1A1B41] p-12 rounded-[40px] border border-[#2E3192] hover:border-blue-500 transition-all flex flex-col items-center gap-6 group shadow-2xl">
            <Smartphone size={56} className="text-blue-500 group-hover:scale-110 transition-transform" />
            <div className="text-center">
              <h2 className="text-3xl font-black mb-2">EQUIPO</h2>
              <p className="text-gray-500 text-xs uppercase tracking-widest">Dispositivo Móvil</p>
            </div>
          </button>
        </div>
      </div>
    );
  }

  if (role === 'player_select') {
    return (
      <div className="min-h-screen bg-[#0B132B] text-white p-8 flex flex-col items-center justify-center font-sans text-center">
        <div className="bg-[#1A1B41] p-10 rounded-[40px] border border-[#2E3192] w-full max-w-md shadow-2xl">
          <ShieldCheck size={48} className="mx-auto mb-6 text-blue-500" />
          <h2 className="text-3xl font-black mb-2 uppercase tracking-tight">Identificación</h2>
          <p className="text-gray-500 text-sm mb-8">Ingresa el nombre de tu unidad de negocio</p>
          <form onSubmit={joinAsTeam} className="space-y-6">
            <input 
              type="text" required maxLength={15} 
              placeholder="Ej: Finanzas" 
              value={joinName} 
              onChange={(e) => setJoinName(e.target.value)} 
              className="w-full bg-[#050814] border-2 border-gray-700 rounded-2xl px-6 py-5 text-2xl text-center outline-none focus:border-blue-500 transition-all font-bold" 
            />
            <button type="submit" disabled={!joinName.trim()} className="w-full bg-blue-500 py-5 rounded-2xl font-black text-xl shadow-[0_0_20px_rgba(0,196,255,0.3)] active:scale-95 transition-all">REGISTRAR EQUIPO</button>
          </form>
        </div>
      </div>
    );
  }

  if (role === 'player') {
    const isReady = gameData?.inputStatus?.[teamId];
    const myTeamData = (gameData?.teams || []).find(t => t.id === teamId);
    return (
      <div className="min-h-screen bg-[#0B132B] text-white p-6 font-sans flex flex-col">
        <header className="flex justify-between items-center mb-10 pb-4 border-b border-gray-800">
           <h1 className="font-black italic text-lg tracking-tighter">SINERGIA <span className="text-orange-500 font-black">CORP</span></h1>
           <span className={`px-4 py-1 rounded-full text-[10px] font-black uppercase ${myTeamData?.color || 'bg-gray-700'}`}>{myTeamData?.name}</span>
        </header>
        <div className="flex-grow flex flex-col justify-center max-w-md mx-auto w-full">
          {gameData?.status === 'setup' && (
            <div className="text-center animate-in fade-in zoom-in duration-500">
              <CheckCircle2 size={80} className="mx-auto text-green-500 mb-6 drop-shadow-[0_0_15px_rgba(34,197,94,0.4)]" />
              <h2 className="text-3xl font-black mb-2 uppercase italic">Conectado</h2>
              <p className="text-gray-500 text-sm">El simulador está en pausa. El consultor iniciará la ronda pronto.</p>
            </div>
          )}
          {gameData?.status === 'playing' && !isReady && (
            <div className="animate-in slide-in-from-bottom-8 duration-500">
              <div className="text-center mb-10">
                <h2 className="text-gray-500 text-xs font-black uppercase tracking-[0.3em] mb-2">Ronda Actual</h2>
                <span className="text-5xl font-black italic">{gameData.currentRound} <span className="text-gray-700 font-normal">/ {TOTAL_ROUNDS}</span></span>
              </div>
              <div className="bg-[#1A1B41] p-10 rounded-[50px] border border-[#2E3192] text-center mb-10 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5"><TrendingUp size={100}/></div>
                <p className="text-gray-400 mb-10 uppercase text-[10px] tracking-[0.3em] font-black">Asignación de Capital</p>
                <div className="flex justify-between items-center mb-12">
                  <button onClick={() => setPlayerInput(Math.max(0, playerInput - 1))} className="w-16 h-16 rounded-full bg-gray-800 text-4xl font-bold active:bg-orange-500 shadow-lg">-</button>
                  <span className="text-9xl font-black text-orange-500 drop-shadow-[0_5px_15px_rgba(255,91,34,0.5)]">{playerInput}</span>
                  <button onClick={() => setPlayerInput(Math.min(INITIAL_TOKENS, playerInput + 1))} className="w-16 h-16 rounded-full bg-gray-800 text-4xl font-bold active:bg-orange-500 shadow-lg">+</button>
                </div>
                <div className="grid grid-cols-2 text-[10px] font-black uppercase tracking-widest text-gray-500 gap-6">
                  <div className="bg-[#050814] py-4 rounded-2xl border border-gray-800">Privado: {INITIAL_TOKENS - playerInput}</div>
                  <div className="bg-[#050814] py-4 rounded-2xl border border-gray-800 text-orange-400/70">Fondo: {playerInput}</div>
                </div>
              </div>
              <button onClick={submitPlayerDecision} className="w-full bg-orange-500 py-6 rounded-[30px] font-black text-xl shadow-[0_0_30px_rgba(255,91,34,0.4)] active:scale-95 transition-all uppercase tracking-widest">ENVIAR DECISIÓN</button>
            </div>
          )}
          {gameData?.status === 'playing' && isReady && (
            <div className="text-center animate-in zoom-in duration-500">
              <Clock size={70} className="mx-auto text-blue-500 mb-8 animate-spin-slow" />
              <h2 className="text-2xl font-black uppercase tracking-widest italic text-blue-400">Datos en Proceso</h2>
              <p className="text-gray-500 mt-4 text-sm px-8">Tu decisión ha sido cifrada. Espera a que el consultor revele el impacto global.</p>
            </div>
          )}
          {gameData?.status === 'reveal' && (
            <div className="text-center animate-in fade-in duration-700">
              <BarChart3 size={60} className="mx-auto text-blue-400 mb-6" />
              <h2 className="text-blue-400 font-black text-2xl mb-6 uppercase tracking-widest italic">Balance Consolidado</h2>
              <div className="bg-[#1A1B41] p-12 rounded-[50px] border border-[#2E3192] shadow-2xl">
                <p className="text-gray-500 text-[10px] font-black mb-4 uppercase tracking-[0.2em]">Patrimonio Acumulado</p>
                <span className="text-8xl font-black text-white">{safeScore(myTeamData?.score)}</span>
                <span className="text-lg font-bold text-gray-600 ml-2">pts</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const allReady = (gameData?.teams || []).length > 0 && (gameData?.teams || []).every(t => gameData?.inputStatus?.[t.id]);
  const maxScore = Math.max(1, ...(gameData?.teams || []).map(t => safeNum(t.score)));

  return (
    <div className="min-h-screen bg-[#0B132B] text-white p-8 font-sans overflow-x-hidden">
      <div className="max-w-6xl mx-auto">
        <header className="flex justify-between items-center mb-16 border-b border-gray-800 pb-8">
          <h1 className="text-5xl font-black tracking-tighter italic">SINERGIA <span className="text-orange-500">CORP</span></h1>
          {gameData?.status !== 'setup' && (
            <div className="text-3xl font-black bg-[#1A1B41] px-10 py-4 rounded-[20px] border border-[#2E3192] italic">
              RONDA {gameData.currentRound} <span className="text-gray-700 font-normal ml-3">/ {TOTAL_ROUNDS}</span>
            </div>
          )}
        </header>
        {gameData?.status === 'setup' && (
          <div className="bg-[#1A1B41] p-20 rounded-[80px] text-center border border-[#2E3192] shadow-2xl">
            <h2 className="text-6xl font-black mb-6 uppercase tracking-tighter italic">Centro de Mando</h2>
            <div className="flex flex-wrap justify-center gap-6 mb-20 min-h-[140px] items-center">
              {(gameData.teams || []).length === 0 ? <p className="text-gray-700 animate-pulse uppercase tracking-widest text-sm">Esperando conexiones entrantes...</p> : 
                (gameData.teams || []).map(t => (
                  <div key={t.id} className="bg-[#050814] px-12 py-6 rounded-[30px] border border-gray-800 font-black text-3xl shadow-2xl animate-in zoom-in">
                    <div className={`w-5 h-5 rounded-full inline-block mr-5 ${t.color}`}></div>{t.name}
                  </div>
                ))}
            </div>
            <button onClick={startGame} disabled={(gameData.teams || []).length < 1} className="bg-orange-500 hover:bg-orange-400 py-10 px-32 rounded-full text-4xl font-black shadow-2xl disabled:opacity-10 uppercase italic">INICIAR EVALUACIÓN</button>
          </div>
        )}
        {gameData?.status === 'playing' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-16">
            <div className="lg:col-span-2">
              <h2 className="text-4xl font-black mb-12 flex items-center gap-6 italic"><Clock size={40} className="text-orange-500 animate-pulse"/> MONITOREO DE ACTIVIDAD</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {(gameData.teams || []).map(t => (
                  <div key={t.id} className={`p-10 rounded-[40px] border transition-all duration-700 ${gameData.inputStatus?.[t.id] ? 'bg-green-500/10 border-green-500/50 shadow-[0_0_30px_rgba(34,197,94,0.1)]' : 'bg-[#1A1B41] border-[#2E3192]'}`}>
                    <div className="flex justify-between items-center">
                      <span className="text-4xl font-black italic">{t.name}</span>
                      {gameData.inputStatus?.[t.id] ? <span className="text-green-400 font-black text-2xl flex items-center gap-3 tracking-tighter"><ShieldCheck size={28} /> RECIBIDO</span> : <span className="text-gray-700 animate-pulse uppercase text-[10px] font-black tracking-[0.4em]">Procesando...</span>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-20 text-right"><button onClick={calculateRound} disabled={!allReady} className="bg-blue-600 hover:bg-blue-500 px-24 py-10 rounded-[35px] font-black text-3xl shadow-3xl disabled:opacity-20 uppercase italic">CONSOLIDAR RESULTADOS <ChevronRight className="inline ml-4" size={32} /></button></div>
            </div>
            <div className="bg-[#050814] p-12 rounded-[60px] border border-gray-800 h-fit shadow-2xl">
              <h3 className="font-black mb-12 text-gray-500 uppercase text-xs tracking-[0.4em] text-center border-b border-gray-800 pb-8 italic">Ranking de Valor</h3>
              <div className="space-y-12">
                {[...(gameData.teams || [])].sort((a,b) => safeNum(b.score) - safeNum(a.score)).map((t, i) => (
                  <div key={t.id}>
                    <div className="flex justify-between mb-4 items-end"><span className="text-2xl font-bold text-gray-500 tracking-tighter">#{i+1} <span className="text-gray-200 ml-2">{t.name}</span></span><span className="font-black text-3xl italic">{safeScore(t.score)}</span></div>
                    <div className="w-full bg-gray-900 h-3 rounded-full border border-gray-800 p-[2px]"><div className={`h-full ${t.color} rounded-full transition-all duration-1000 ease-out`} style={{ width: `${(safeNum(t.score) / maxScore) * 100}%` }}></div></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {gameData?.status === 'reveal' && (
          <div className="space-y-20 animate-in slide-in-from-bottom-12 duration-1000">
            <h2 className="text-6xl font-black text-center tracking-tighter italic">REPORTE DE RESULTADOS - RONDA {gameData.currentRound}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12 text-center text-white">
               <div className="bg-[#1A1B41] p-14 rounded-[50px] border border-gray-800 shadow-2xl"><p className="text-gray-500 text-[10px] mb-6 tracking-[0.4em] uppercase font-black">Capital Invertido</p><span className="text-9xl font-black italic">{safeNum(gameData.roundResult.totalInvested)}</span></div>
               <div className="bg-gradient-to-br from-[#2E3192] to-[#9D4EDD] p-14 rounded-[50px] shadow-2xl transform scale-110"><p className="text-white/60 text-[10px] mb-6 tracking-[0.4em] uppercase font-black">Multiplicado x{gameData.currentRound === 5 ? '3' : '2'}</p><span className="text-9xl font-black italic">{safeNum(gameData.roundResult.multipliedFund)}</span></div>
               <div className="bg-[#1A1B41] p-14 rounded-[50px] border border-gray-800 shadow-2xl"><p className="text-gray-500 text-[10px] mb-6 tracking-[0.4em] uppercase font-black">Utilidad Grupal p/e</p><span className="text-9xl font-black text-green-400 italic">+{safeScore(gameData.roundResult.payoutPerTeam)}</span></div>
            </div>
            <div className="bg-[#1A1B41] rounded-[60px] border border-[#2E3192] overflow-hidden">
               <table className="w-full text-left">
                  <thead className="bg-[#0B132B]"><tr className="text-gray-500 text-xs uppercase font-black tracking-[0.3em]"><th className="p-12">Unidad</th><th className="p-12 text-center">Aporte</th><th className="p-12 text-center text-green-400">Gana</th><th className="p-12 text-right">Patrimonio</th></tr></thead>
                  <tbody className="divide-y divide-gray-800/30">
                    {gameData.roundResult.details?.map(d => (
                      <tr key={d.id} className="hover:bg-white/5"><td className="p-12 text-4xl font-black italic">{d.name}</td><td className="p-12 text-center text-6xl font-black text-orange-500">{d.invested}</td><td className="p-12 text-center text-green-400 font-black text-4xl">+{safeScore(d.kept + gameData.roundResult.payoutPerTeam)}</td><td className="p-12 text-right text-6xl font-black">{safeScore((gameData.teams || []).find(t => t.id === d.id)?.score)}</td></tr>
                    ))}
                  </tbody>
               </table>
            </div>
            <div className="flex justify-center"><button onClick={nextRound} className="bg-orange-500 py-12 px-24 rounded-full text-4xl font-black uppercase italic">{gameData.currentRound >= TOTAL_ROUNDS ? 'FINALIZAR' : `SIGUIENTE RONDA`}</button></div>
          </div>
        )}
        {gameData?.status === 'end' && (
          <div className="text-center space-y-20">
            <Trophy size={200} className="mx-auto text-yellow-500 mb-10" />
            <h2 className="text-8xl font-black uppercase italic">Simulación Exitosa</h2>
            <div className="bg-[#1A1B41] p-20 rounded-[80px] max-w-4xl mx-auto border border-[#2E3192]">
              <h3 className="text-blue-400 font-black mb-16 uppercase text-2xl italic">Indicadores Finales</h3>
              {([...(gameData.teams || [])].sort((a,b) => safeNum(b.score) - safeNum(a.score))).map((t, i) => (
                <div key={t.id} className="flex justify-between items-center mb-8 pb-8 border-b border-gray-800 last:border-0 last:mb-0 last:pb-0">
                  <span className="text-6xl font-black text-gray-700 italic">#{i+1} <span className="text-white ml-4 font-black">{t.name}</span></span>
                  <span className="text-7xl font-black italic">{safeScore(t.score)} pts</span>
                </div>
              ))}
            </div>
            <button onClick={resetGame} className="text-gray-600 border-2 border-gray-800 px-16 py-8 rounded-full font-black uppercase tracking-[0.5em] hover:bg-gray-800 transition-all italic">REINICIAR SISTEMA</button>
          </div>
        )}
      </div>
    </div>
  );
}
