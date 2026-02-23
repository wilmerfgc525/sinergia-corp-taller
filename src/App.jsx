import React, { useState, useEffect } from 'react';
import { Users, TrendingUp, Wallet, AlertCircle, ChevronRight, Trophy, RotateCcw, CheckCircle2, Clock, Smartphone, Plus, Eye, EyeOff } from 'lucide-react';

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

// --- INICIALIZACIÓN DE FIREBASE ---
let app, auth, db, appId;
try {
  // Validación de seguridad para el acceso a variables de entorno de Vite
  const getEnvVar = (name) => {
    try {
      return import.meta.env[name];
    } catch (e) {
      return undefined;
    }
  };

  const firebaseConfig = {
    // Si import.meta.env no existe, usamos la clave hardcoded como respaldo seguro
    apiKey: getEnvVar('VITE_FIREBASE_API_KEY') || "AIzaSyC1MTCPfK9T062TkG_L1YgOs47qoJwWTH8",
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
  // Identificador único para el taller
  appId = 'sinergia-corp-taller-01';
} catch (e) {
  console.error("Error al iniciar Firebase", e);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [role, setRole] = useState(null); // 'none', 'facilitator', 'player_select', 'player'
  const [teamId, setTeamId] = useState(null);
  const [gameData, setGameData] = useState(null);
  const [playerInput, setPlayerInput] = useState(0);
  const [joinName, setJoinName] = useState('');

  // 1. Inicialización de Autenticación (Anónima)
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.error("Error de Auth:", err);
        setAuthError("No se pudo conectar al servidor. Activa el login anónimo en Firebase.");
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. Sincronización de Datos en Tiempo Real (Firestore)
  useEffect(() => {
    if (!user || !db) return;

    // Ruta estricta de Firestore para datos públicos
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'game_session', 'main');
    
    const unsubscribe = onSnapshot(docRef, 
      (docSnap) => {
        if (docSnap.exists()) {
          setGameData(docSnap.data());
        } else {
          // Si la sesión no existe y soy facilitador, la creo
          if (role === 'facilitator') {
            setDoc(docRef, defaultGameState);
          } else {
            setGameData({ status: 'waiting_host', teams: [] });
          }
        }
      },
      (err) => console.error("Error de Sincronización:", err)
    );

    return () => unsubscribe();
  }, [user, role]);

  // Si el facilitador reinicia el juego, sacamos a los jugadores a la pantalla de unión
  useEffect(() => {
    if (role === 'player' && gameData?.status === 'setup' && teamId) {
      const teamExists = (gameData.teams || []).some(t => t.id === teamId);
      if (!teamExists) {
        setRole(null);
        setTeamId(null);
      }
    }
  }, [gameData, role, teamId]);

  // --- ACCIONES DEL FACILITADOR ---
  const getDocRef = () => doc(db, 'artifacts', appId, 'public', 'data', 'game_session', 'main');

  const updateGameData = async (updates) => {
    if (!gameData || gameData.status === 'waiting_host') return;
    try {
      await updateDoc(getDocRef(), updates);
    } catch (error) {
      await setDoc(getDocRef(), { ...gameData, ...updates }, { merge: true });
    }
  };

  const handleFacilitatorStart = async () => {
    setRole('facilitator');
    await setDoc(getDocRef(), defaultGameState, { merge: true });
  };

  const startGame = () => {
    const emptyInputs = {};
    const emptyStatus = {};
    (gameData.teams || []).forEach(t => { 
      emptyInputs[t.id] = 0; 
      emptyStatus[t.id] = false; 
    });
    
    updateGameData({ 
      status: 'playing', 
      currentRound: 1, 
      currentInputs: emptyInputs, 
      inputStatus: emptyStatus 
    });
  };

  const calculateRound = () => {
    if (!gameData) return;
    
    let totalInvested = 0;
    const playerDetails = [];
    const multiplier = gameData.currentRound === 5 ? 3 : 2;

    // Calcular suma del fondo
    (gameData.teams || []).forEach(team => {
      const invested = safeNum(gameData.currentInputs?.[team.id]);
      totalInvested += invested;
      playerDetails.push({
        ...team,
        invested,
        kept: INITIAL_TOKENS - invested,
      });
    });

    const multipliedFund = totalInvested * multiplier;
    const numTeams = Math.max(1, (gameData.teams || []).length); 
    const payoutPerTeam = multipliedFund / numTeams;

    // Actualizar puntajes acumulados con protección contra nulos
    const updatedTeams = (gameData.teams || []).map(team => {
      const invested = safeNum(gameData.currentInputs?.[team.id]);
      const kept = INITIAL_TOKENS - invested;
      const roundEarned = kept + payoutPerTeam;
      return { ...team, score: safeNum(team.score) + roundEarned };
    });

    updateGameData({
      teams: updatedTeams,
      roundResult: {
        totalInvested,
        multipliedFund,
        payoutPerTeam,
        details: playerDetails
      },
      history: [...(gameData.history || []), { round: gameData.currentRound, totalInvested, payoutPerTeam }],
      status: 'reveal'
    });
  };

  const nextRound = () => {
    if (!gameData) return;
    if (gameData.currentRound >= TOTAL_ROUNDS) {
      updateGameData({ status: 'end' });
    } else {
      const emptyStatus = {};
      (gameData.teams || []).forEach(t => { emptyStatus[t.id] = false; });

      updateGameData({
        currentRound: gameData.currentRound + 1,
        status: 'playing',
        inputStatus: emptyStatus,
        roundResult: null
      });
      setPlayerInput(0); 
    }
  };

  const resetGame = () => {
    setDoc(getDocRef(), defaultGameState);
  };

  // --- ACCIONES DEL JUGADOR ---
  const joinAsTeam = async (e) => {
    e.preventDefault();
    if (!joinName.trim() || !gameData) return;

    const newId = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
    const color = TEAM_COLORS[(gameData.teams || []).length % TEAM_COLORS.length];
    const newTeam = { id: newId, name: joinName.trim(), color, score: 0 };

    await setDoc(getDocRef(), {
      teams: [...(gameData.teams || []), newTeam],
      inputStatus: { ...(gameData.inputStatus || {}), [newId]: false }
    }, { merge: true });

    setTeamId(newId);
    setRole('player');
  };

  const submitPlayerDecision = async () => {
    if (!gameData || !teamId) return;
    const val = Math.max(0, Math.min(INITIAL_TOKENS, Number(playerInput) || 0));
    
    // Usamos corchetes para actualizar llaves dinámicas en Firestore
    await setDoc(getDocRef(), {
      [`currentInputs.${teamId}`]: val,
      [`inputStatus.${teamId}`]: true
    }, { merge: true });
  };

  // --- COMPONENTES DE INTERFAZ ---

  if (authError) {
    return <div className="min-h-screen bg-[#0B132B] flex items-center justify-center p-8"><div className="bg-red-500/10 border border-red-500 text-red-100 p-6 rounded-xl max-w-md text-center"><AlertCircle className="mx-auto mb-4" size={48} />{authError}</div></div>;
  }

  if (!user) {
    return <div className="min-h-screen bg-[#0B132B] flex items-center justify-center text-white"><Clock className="animate-spin mr-3"/> Entrando a Sinergia Corp...</div>;
  }

  // --- PANTALLA: SELECCIÓN DE ROL ---
  if (!role) {
    return (
      <div className="min-h-screen bg-[#0B132B] text-white p-4 md:p-8 flex flex-col items-center justify-center font-sans">
        <div className="text-center mb-12">
          <TrendingUp size={80} className="mx-auto text-orange-500 mb-6" />
          <h1 className="text-5xl font-black mb-4 tracking-tight">Sinergia <span className="text-orange-500">Corp</span></h1>
          <p className="text-xl text-gray-400">Teoría de juegos aplicada al alto rendimiento</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl w-full">
          <button 
            onClick={handleFacilitatorStart}
            className="bg-[#1A1B41] border border-[#2E3192] p-8 md:p-10 rounded-3xl hover:border-orange-500 transition-all group flex flex-col items-center text-center shadow-2xl"
          >
            <div className="bg-orange-500/20 p-6 rounded-full mb-6 group-hover:scale-110 transition-transform">
              <Users size={48} className="text-orange-500" />
            </div>
            <h2 className="text-3xl font-bold mb-2">Soy Facilitador</h2>
            <p className="text-gray-400 text-sm">Gestionar la sala y proyectar resultados globales.</p>
          </button>

          <button 
            onClick={() => setRole('player_select')}
            className="bg-[#1A1B41] border border-[#2E3192] p-8 md:p-10 rounded-3xl hover:border-blue-500 transition-all group flex flex-col items-center text-center shadow-2xl"
          >
            <div className="bg-blue-500/20 p-6 rounded-full mb-6 group-hover:scale-110 transition-transform">
              <Smartphone size={48} className="text-blue-500" />
            </div>
            <h2 className="text-3xl font-bold mb-2">Soy un Equipo</h2>
            <p className="text-gray-400 text-sm">Votar y participar desde mi propio dispositivo móvil.</p>
          </button>
        </div>
      </div>
    );
  }

  // --- PANTALLA: REGISTRO DE EQUIPO ---
  if (role === 'player_select') {
    if (gameData?.status === 'waiting_host') {
      return (
        <div className="min-h-screen bg-[#0B132B] text-white p-8 flex flex-col items-center justify-center text-center">
          <Clock size={64} className="text-gray-500 mb-6 animate-pulse" />
          <h2 className="text-3xl font-bold mb-4">Sala en preparación</h2>
          <p className="text-xl text-gray-400 max-w-md">El facilitador aún no ha abierto la sala. Por favor, mantén esta pestaña abierta.</p>
          <button onClick={() => setRole(null)} className="mt-12 text-gray-500 hover:text-white">Regresar</button>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-[#0B132B] text-white p-4 md:p-8 flex flex-col items-center justify-center font-sans">
        <div className="bg-[#1A1B41] p-8 md:p-12 rounded-3xl border border-[#2E3192] shadow-2xl max-w-md w-full text-center">
          <h2 className="text-3xl font-bold mb-2">Únete al Reto</h2>
          <p className="text-gray-400 mb-8">Ingresa el nombre de tu equipo o unidad de negocio.</p>
          <form onSubmit={joinAsTeam} className="space-y-6">
            <input
              type="text" required maxLength={15}
              placeholder="Ej: Finanzas"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              className="w-full bg-[#050814] border-2 border-gray-700 focus:border-blue-500 rounded-xl px-6 py-4 text-xl font-bold text-center text-white outline-none transition-colors"
            />
            <button 
              type="submit" disabled={!joinName.trim()}
              className="w-full bg-blue-500 hover:bg-blue-400 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold py-4 rounded-xl text-lg flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(0,196,255,0.3)]"
            >
              <Plus size={24} /> Registrarme
            </button>
          </form>
        </div>
        <button onClick={() => setRole(null)} className="mt-8 text-gray-500 hover:text-white">Cancelar</button>
      </div>
    );
  }

  if (!gameData || gameData.status === 'waiting_host') {
    return <div className="min-h-screen bg-[#0B132B] flex items-center justify-center text-white text-xl">Sincronizando...</div>;
  }

  // --- VARIABLES DE CÁLCULO SEGURO ---
  const isTripleRound = gameData.currentRound === 5;
  const currentMultiplier = isTripleRound ? 3 : 2;
  const maxScoreFound = Math.max(1, ...(gameData.teams || []).map(t => safeNum(t.score)));
  const allTeamsReady = (gameData.teams || []).length > 0 && (gameData.teams || []).every(team => gameData.inputStatus?.[team.id] === true);
  const myTeam = role === 'player' ? (gameData.teams || []).find(t => t.id === teamId) : null;
  const myInputStatus = role === 'player' ? (gameData.inputStatus?.[teamId] || false) : false;

  const HeaderUI = ({ isFacilitator }) => (
    <header className="flex flex-wrap gap-4 justify-between items-center mb-8 border-b border-gray-800 pb-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-white tracking-wide flex items-center gap-3">
          Sinergia <span className="text-orange-500">Corp</span>
          {isFacilitator ? 
            <span className="bg-gray-800 text-[10px] px-2 py-1 rounded text-gray-400 font-normal uppercase tracking-widest">Consultor</span> :
            <span className={`text-[10px] px-3 py-1 rounded-full font-bold text-white ${myTeam?.color} uppercase tracking-widest`}>{myTeam?.name}</span>
          }
        </h1>
      </div>
      {gameData.status !== 'setup' && gameData.status !== 'end' && (
        <div className="flex items-center gap-4">
          <div className="bg-[#1A1B41] px-4 py-2 rounded-lg border border-[#2E3192] flex items-center gap-3">
            <span className="text-gray-400 text-xs uppercase tracking-widest">Ronda</span>
            <div className="text-xl font-bold text-white">{gameData.currentRound} / {TOTAL_ROUNDS}</div>
          </div>
        </div>
      )}
    </header>
  );

  // --- VISTA: JUGADOR (MÓVIL) ---
  if (role === 'player') {
    return (
      <div className="min-h-screen bg-[#0B132B] text-white p-4 md:p-8 font-sans">
        <div className="max-w-md mx-auto">
          <HeaderUI isFacilitator={false} />
          
          {gameData.status === 'setup' && (
            <div className="bg-[#1A1B41] p-8 rounded-2xl border border-green-500/30 text-center animate-in slide-in-from-bottom-4">
              <CheckCircle2 size={64} className="mx-auto text-green-500 mb-4" />
              <h3 className="text-2xl font-bold mb-2">¡Registrado!</h3>
              <p className="text-gray-400 text-sm mb-6">Miren la pantalla principal. El facilitador iniciará pronto.</p>
              <div className="inline-flex items-center gap-2 text-xs text-blue-400 bg-blue-500/10 px-4 py-2 rounded-full">
                <Clock size={14} className="animate-pulse" /> Esperando Ronda 1...
              </div>
            </div>
          )}

          {gameData.status === 'playing' && !myInputStatus && (
            <div className="bg-[#1A1B41] p-6 rounded-2xl border border-[#2E3192] shadow-2xl animate-in slide-in-from-bottom-4">
              <h2 className="text-2xl font-bold text-center mb-2">Tu Decisión</h2>
              <p className="text-gray-400 text-center text-sm mb-8">¿Cuánto invertirás en el fondo del equipo?</p>
              
              <div className="flex justify-center items-center gap-8 mb-10">
                <button onClick={() => setPlayerInput(Math.max(0, playerInput - 1))} className="w-16 h-16 rounded-full bg-gray-800 text-3xl font-bold">-</button>
                <div className="text-7xl font-black text-orange-500 w-24 text-center">{playerInput}</div>
                <button onClick={() => setPlayerInput(Math.min(INITIAL_TOKENS, playerInput + 1))} className="w-16 h-16 rounded-full bg-gray-800 text-3xl font-bold">+</button>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-8 text-xs text-center border-t border-gray-800 pt-6">
                <div><span className="block text-xl font-bold text-white">{INITIAL_TOKENS - playerInput}</span> PRIVADO</div>
                <div><span className="block text-xl font-bold text-orange-500">{playerInput}</span> FONDO</div>
              </div>

              <button onClick={submitPlayerDecision} className="w-full py-5 rounded-xl font-black text-lg bg-orange-500 shadow-[0_0_20px_rgba(255,91,34,0.4)] active:scale-95 transition-all">ENVIAR DECISIÓN</button>
            </div>
          )}

          {(gameData.status === 'playing' && myInputStatus) && (
             <div className="bg-[#1A1B41] p-10 rounded-2xl border border-green-500/20 text-center">
              <CheckCircle2 size={64} className="mx-auto text-green-500 mb-4" />
              <p className="text-gray-300">Decisión enviada con éxito.</p>
              <p className="text-xs text-gray-500 mt-4 animate-pulse">Esperando a los demás equipos...</p>
            </div>
          )}

          {gameData.status === 'reveal' && (
             <div className="bg-[#1A1B41] p-8 rounded-2xl border border-blue-500/30 text-center animate-in zoom-in-95 duration-500">
                <h3 className="text-xl font-bold mb-6 text-blue-400 uppercase tracking-widest">Resultados de Ronda</h3>
                <div className="bg-[#0B132B] p-6 rounded-2xl border border-gray-800">
                  <p className="text-gray-500 text-xs mb-1 uppercase">Puntaje Acumulado</p>
                  <span className="text-5xl font-black text-white">{safeScore(myTeam?.score)} <span className="text-sm font-normal text-gray-500">pts</span></span>
                </div>
                <p className="text-gray-400 text-sm mt-8 italic">Mira la pantalla del consultor para el desglose matemático.</p>
             </div>
          )}

          {gameData.status === 'end' && (
            <div className="bg-[#1A1B41] p-10 rounded-2xl border border-yellow-500/30 text-center">
                <Trophy size={64} className="mx-auto text-yellow-500 mb-6" />
                <h3 className="text-3xl font-black mb-2">Simulación Finalizada</h3>
                <p className="text-gray-400 text-sm uppercase tracking-widest">Gracias por participar</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- VISTA: FACILITADOR (PROYECTOR) ---
  return (
    <div className="min-h-screen bg-[#0B132B] text-white p-8 font-sans">
      <div className="max-w-6xl mx-auto">
        <HeaderUI isFacilitator={true} />
        
        {gameData.status === 'setup' && (
          <div className="bg-[#1A1B41] p-12 rounded-3xl border border-[#2E3192] shadow-2xl text-center max-w-3xl mx-auto">
            <h2 className="text-4xl font-bold mb-6">Sala de Espera Directiva</h2>
            <p className="text-gray-400 mb-10 text-lg">Los equipos aparecerán aquí una vez se registren desde sus dispositivos móviles.</p>
            <div className="bg-[#050814] rounded-2xl p-10 mb-10 min-h-[150px] flex flex-wrap gap-4 justify-center items-center border border-gray-800">
              {(gameData.teams || []).length === 0 ? (
                <p className="text-gray-600 italic">Esperando conexiones...</p>
              ) : (
                (gameData.teams || []).map(team => (
                  <div key={team.id} className="bg-[#1A1B41] border border-gray-700 px-8 py-4 rounded-full flex items-center gap-4 animate-in zoom-in">
                    <div className={`w-4 h-4 rounded-full ${team.color}`}></div>
                    <span className="font-black text-xl">{team.name}</span>
                  </div>
                ))
              )}
            </div>
            <button 
              onClick={startGame} disabled={(gameData.teams || []).length < 1}
              className="bg-orange-500 hover:bg-orange-400 py-5 px-16 rounded-full text-2xl font-black shadow-[0_0_25px_rgba(255,91,34,0.4)] transition-all active:scale-95"
            >
              INICIAR DINÁMICA
            </button>
          </div>
        )}

        {gameData.status === 'playing' && (
           <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                <h2 className="text-3xl font-bold flex items-center gap-4">
                  Estado de Decisiones 
                  <span className="text-sm bg-gray-800 px-3 py-1 rounded-full text-gray-400 font-normal">En curso</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(gameData.teams || []).map(team => (
                    <div key={team.id} className={`bg-[#1A1B41] p-6 rounded-2xl border transition-all ${gameData.inputStatus?.[team.id] ? 'border-green-500/50 bg-green-500/5' : 'border-[#2E3192]'}`}>
                      <div className="flex justify-between items-center">
                        <h3 className="font-bold text-2xl">{team.name}</h3>
                        {gameData.inputStatus?.[team.id] ? 
                          <span className="text-green-400 font-black flex items-center gap-2 animate-in fade-in"><CheckCircle2 size={20}/> RECIBIDO</span> : 
                          <span className="text-gray-500 text-sm animate-pulse flex items-center gap-2"><Clock size={16}/> PENSANDO...</span>
                        }
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mt-12">
                  <button 
                    onClick={calculateRound} disabled={!allTeamsReady}
                    className="bg-blue-500 hover:bg-blue-400 py-5 px-12 rounded-2xl font-black text-xl shadow-[0_0_20px_rgba(0,196,255,0.4)] disabled:opacity-50 transition-all"
                  >
                    REVELAR RESULTADOS <ChevronRight className="inline ml-2" />
                  </button>
                </div>
              </div>

              <div className="bg-[#050814] p-8 rounded-3xl border border-gray-800 h-fit">
                <h3 className="text-xl font-bold mb-8 flex items-center gap-3"><Trophy className="text-orange-500"/> Ranking Estratégico</h3>
                <div className="space-y-6">
                  {[...(gameData.teams || [])].sort((a,b) => safeNum(b.score) - safeNum(a.score)).map((team, idx) => (
                    <div key={team.id}>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-gray-400">{idx + 1}. {team.name}</span>
                        <span className="font-black text-white">{safeScore(team.score)} pts</span>
                      </div>
                      <div className="w-full bg-gray-800 rounded-full h-2">
                        <div className={`h-2 rounded-full ${team.color} transition-all duration-1000`} style={{ width: `${(safeNum(team.score) / maxScoreFound) * 100}%` }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
           </div>
        )}

        {gameData.status === 'reveal' && gameData.roundResult && (
          <div className="space-y-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <h2 className="text-4xl font-black text-center mb-4">Resultados de la Ronda {gameData.currentRound}</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-[#1A1B41] p-8 rounded-3xl border border-gray-800 text-center">
                <p className="text-gray-500 text-sm uppercase mb-2 tracking-widest">Inversión Total</p>
                <div className="text-6xl font-black">{safeNum(gameData.roundResult.totalInvested)}</div>
              </div>
              <div className="bg-gradient-to-br from-[#2E3192] to-[#9D4EDD] p-8 rounded-3xl text-center shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10"><TrendingUp size={80}/></div>
                <p className="text-white/60 text-sm uppercase mb-2 tracking-widest relative z-10">Fondo Multiplicado x{currentMultiplier}</p>
                <div className="text-7xl font-black relative z-10">{safeNum(gameData.roundResult.multipliedFund)}</div>
              </div>
              <div className="bg-[#1A1B41] p-8 rounded-3xl border border-gray-800 text-center">
                <p className="text-gray-500 text-sm uppercase mb-2 tracking-widest">Retorno Individual</p>
                <div className="text-6xl font-black text-green-400">+{safeScore(gameData.roundResult.payoutPerTeam)}</div>
              </div>
            </div>

            <div className="bg-[#1A1B41] rounded-3xl border border-[#2E3192] overflow-hidden shadow-2xl">
              <table className="w-full text-left">
                <thead className="bg-[#0B132B]">
                  <tr className="text-gray-400 text-xs uppercase tracking-widest">
                    <th className="p-6">Equipo</th>
                    <th className="p-6 text-center">Inv. Fondo</th>
                    <th className="p-6 text-center">Bolsillo</th>
                    <th className="p-6 text-center text-green-400">Ganancia</th>
                    <th className="p-6 text-right">Puntaje Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {(gameData.roundResult.details || []).map(team => (
                    <tr key={team.id} className="hover:bg-white/5 transition-colors">
                      <td className="p-6 font-bold flex items-center gap-4">
                         <div className={`w-3 h-3 rounded-full ${team.color}`}></div> {team.name}
                      </td>
                      <td className="p-6 text-center text-2xl font-black">{safeNum(team.invested)}</td>
                      <td className="p-6 text-center text-gray-500">{safeNum(team.kept)}</td>
                      <td className="p-6 text-center text-green-400 font-bold">+{safeScore(safeNum(team.kept) + safeNum(gameData.roundResult.payoutPerTeam))}</td>
                      <td className="p-6 text-right font-black text-3xl">
                        {safeScore((gameData.teams || []).find(t => t.id === team.id)?.score)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-center mt-12">
              <button 
                onClick={nextRound} 
                className="bg-orange-500 hover:bg-orange-400 py-6 px-20 rounded-full text-2xl font-black shadow-[0_0_30px_rgba(255,91,34,0.5)] transition-all active:scale-95"
              >
                {gameData.currentRound >= TOTAL_ROUNDS ? 'VER RESULTADOS FINALES' : `AVANZAR A RONDA ${gameData.currentRound + 1}`}
              </button>
            </div>
          </div>
        )}

        {gameData.status === 'end' && (
          <div className="text-center space-y-12 animate-in zoom-in duration-700">
            <div className="space-y-4">
              <Trophy size={100} className="mx-auto text-yellow-500 mb-6 drop-shadow-[0_0_20px_rgba(234,179,8,0.5)]" />
              <h2 className="text-6xl font-black">Simulación Exitosa</h2>
              <p className="text-gray-400 text-xl max-w-2xl mx-auto">La desconfianza tiene un costo matemático. La colaboración es la estrategia más rentable.</p>
            </div>

            <div className="bg-[#1A1B41] p-10 rounded-[40px] max-w-2xl mx-auto border border-[#2E3192] shadow-2xl">
              <h3 className="text-2xl font-bold mb-10 uppercase tracking-widest text-blue-400">Puntajes de Gestión Finales</h3>
              {[...(gameData.teams || [])].sort((a,b) => safeNum(b.score) - safeNum(a.score)).map((team, idx) => (
                <div key={team.id} className="flex justify-between items-center mb-6 border-b border-gray-800 pb-4 last:border-0 last:mb-0">
                  <div className="flex items-center gap-4">
                    <span className="text-gray-600 font-bold text-2xl">#{idx + 1}</span>
                    <span className="text-2xl font-bold">{team.name}</span>
                  </div>
                  <span className="text-3xl font-black text-white">{safeScore(team.score)} <span className="text-sm font-normal text-gray-500">pts</span></span>
                </div>
              ))}
            </div>
            
            <div className="pt-10 flex flex-col items-center gap-4">
              <p className="text-gray-600 text-sm">¿Deseas aplicar una nueva estrategia?</p>
              <button onClick={resetGame} className="text-gray-400 hover:text-white flex items-center gap-2 transition-colors border border-gray-800 px-6 py-3 rounded-full">
                <RotateCcw size={18}/> Reiniciar Dinámica para otro equipo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}