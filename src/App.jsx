import React, { useState, useEffect } from 'react';
import { Users, TrendingUp, Wallet, AlertCircle, ChevronRight, Trophy, RotateCcw, CheckCircle2, Clock, Smartphone, Plus } from 'lucide-react';

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, updateDoc } from 'firebase/firestore';

const TOTAL_ROUNDS = 5;
const INITIAL_TOKENS = 10;

// Paleta de colores para asignar automáticamente a los equipos que se unan
const TEAM_COLORS = [
  'bg-blue-500', 'bg-orange-500', 'bg-purple-500', 'bg-teal-500', 
  'bg-pink-500', 'bg-red-500', 'bg-green-500', 'bg-indigo-500', 'bg-yellow-500'
];

// --- INITIAL STATE ---
const defaultGameState = {
  status: 'setup', // setup, playing, reveal, end, waiting_host
  currentRound: 1,
  teams: [], 
  currentInputs: {}, 
  inputStatus: {}, 
  roundResult: null,
  history: []
};

// --- FIREBASE INITIALIZATION ---
let app, auth, db, appId;
try {
  const firebaseConfig = {
    apiKey: "AIzaSyC1MTCPfK9T062TkG_L1YgOs47qoJwWTH8",
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
  appId = 'sinergia-corp-taller'; // Identificador único de tu sesión
} catch (e) {
  console.error("Firebase init error", e);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [role, setRole] = useState(null); // 'none', 'facilitator', 'player_select', 'player'
  const [teamId, setTeamId] = useState(null);
  const [gameData, setGameData] = useState(null);
  const [playerInput, setPlayerInput] = useState(0);
  const [joinName, setJoinName] = useState('');

  // 1. Auth Init: Login anónimo directo para despliegues externos
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        await signInAnonymously(auth); 
      } catch (err) {
        console.error("Auth error:", err);
        setAuthError("Error de autenticación. Verifica que el 'Inicio de sesión anónimo' esté habilitado en Firebase Authentication.");
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. Data Sync Blindado (Eliminamos dependencia del rol para que nunca se desconecte)
  useEffect(() => {
    if (!user || !db) return;

    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'game_session', 'main');
    
    const unsubscribe = onSnapshot(docRef, 
      (docSnap) => {
        if (docSnap.exists()) {
          setGameData(docSnap.data());
        } else {
          // Si el documento NO existe, ponemos a todos en espera
          setGameData({ status: 'waiting_host', teams: [] });
        }
      },
      (err) => console.error("Snapshot error:", err)
    );

    return () => unsubscribe();
  }, [user]);

  // Si el facilitador reinicia el juego, desconectamos a los jugadores
  useEffect(() => {
    if (role === 'player' && gameData?.status === 'setup' && teamId && !(gameData.teams || []).find(t => t.id === teamId)) {
      setRole(null);
      setTeamId(null);
      setJoinName('');
    }
  }, [gameData, role, teamId]);

  // --- ACTIONS (GENERAL) ---
  const getDocRef = () => doc(db, 'artifacts', appId, 'public', 'data', 'game_session', 'main');

  const updateGameData = async (updates) => {
    if (!gameData || gameData.status === 'waiting_host') return;
    try {
      await updateDoc(getDocRef(), updates);
    } catch (error) {
      await setDoc(getDocRef(), { ...gameData, ...updates }, { merge: true });
    }
  };

  // --- ACTIONS (FACILITATOR) ---
  const handleFacilitatorStart = async () => {
    try {
      setRole('facilitator');
      await setDoc(getDocRef(), defaultGameState, { merge: true });
    } catch (error) {
      console.error("Error creando sala:", error);
      alert("Hubo un error al crear la sala. Asegúrate de tener las reglas de Firestore en modo prueba.");
    }
  };

  const startGame = () => {
    const emptyInputs = {};
    const emptyStatus = {};
    (gameData.teams || []).forEach(t => { emptyInputs[t.id] = 0; emptyStatus[t.id] = false; });
    
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

    (gameData.teams || []).forEach(team => {
      const invested = gameData.currentInputs[team.id] || 0;
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

    const updatedTeams = (gameData.teams || []).map(team => {
      const invested = gameData.currentInputs[team.id] || 0;
      const kept = INITIAL_TOKENS - invested;
      const roundEarned = kept + payoutPerTeam;
      return { ...team, score: team.score + roundEarned };
    });

    const newRoundResult = {
      totalInvested,
      multipliedFund,
      payoutPerTeam,
      details: playerDetails
    };

    updateGameData({
      teams: updatedTeams,
      roundResult: newRoundResult,
      history: [...(gameData.history || []), { round: gameData.currentRound, totalInvested, payoutPerTeam }],
      status: 'reveal'
    });
  };

  const nextRound = () => {
    if (!gameData) return;
    if (gameData.currentRound >= TOTAL_ROUNDS) {
      updateGameData({ status: 'end' });
    } else {
      const emptyInputs = {};
      const emptyStatus = {};
      (gameData.teams || []).forEach(t => {
        emptyInputs[t.id] = 0;
        emptyStatus[t.id] = false;
      });

      updateGameData({
        currentRound: gameData.currentRound + 1,
        status: 'playing',
        currentInputs: emptyInputs,
        inputStatus: emptyStatus,
        roundResult: null
      });
      setPlayerInput(0); 
    }
  };

  const resetGame = () => {
    setDoc(getDocRef(), defaultGameState);
  };

  // --- ACTIONS (PLAYER) ---
  const joinAsTeam = async (e) => {
    e.preventDefault();
    if (!joinName.trim() || !gameData || gameData.status === 'waiting_host') return;

    const newId = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
    const color = TEAM_COLORS[(gameData.teams || []).length % TEAM_COLORS.length];
    const newTeam = { id: newId, name: joinName.trim(), color, score: 0 };

    await setDoc(getDocRef(), {
      teams: [...(gameData.teams || []), newTeam],
      currentInputs: { ...(gameData.currentInputs || {}), [newId]: 0 },
      inputStatus: { ...(gameData.inputStatus || {}), [newId]: false }
    }, { merge: true });

    setTeamId(newId);
    setRole('player');
  };

  const submitPlayerDecision = async () => {
    if (!gameData || !teamId) return;
    const val = Math.max(0, Math.min(INITIAL_TOKENS, Number(playerInput) || 0));
    
    await setDoc(getDocRef(), {
      currentInputs: { [teamId]: val },
      inputStatus: { [teamId]: true }
    }, { merge: true });
  };


  // --- UI SCREENS ---

  if (authError) {
    return <div className="min-h-screen bg-[#0B132B] flex items-center justify-center p-8"><div className="bg-red-500/10 border border-red-500 text-red-100 p-6 rounded-xl max-w-md text-center"><AlertCircle className="mx-auto mb-4" size={48} />{authError}</div></div>;
  }

  if (!user) {
    return <div className="min-h-screen bg-[#0B132B] flex items-center justify-center text-white"><Clock className="animate-spin mr-3"/> Entrando a la sala segura...</div>;
  }

  // --- Pantalla Inicial de Selección de Rol ---
  if (!role) {
    return (
      <div className="min-h-screen bg-[#0B132B] text-white p-4 md:p-8 flex flex-col items-center justify-center font-sans">
        <div className="text-center mb-12 animate-in fade-in zoom-in duration-500">
          <TrendingUp size={80} className="mx-auto text-orange-500 mb-6" />
          <h1 className="text-5xl font-black mb-4 tracking-tight">Sinergia <span className="text-orange-500">Corp</span></h1>
          <p className="text-xl text-gray-400">Selecciona tu rol para iniciar la dinámica</p>
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
            <p className="text-gray-400">Crear la sala y proyectar pantalla principal.</p>
          </button>

          <button 
            onClick={() => setRole('player_select')}
            className="bg-[#1A1B41] border border-[#2E3192] p-8 md:p-10 rounded-3xl hover:border-blue-500 transition-all group flex flex-col items-center text-center shadow-2xl"
          >
            <div className="bg-blue-500/20 p-6 rounded-full mb-6 group-hover:scale-110 transition-transform">
              <Smartphone size={48} className="text-blue-500" />
            </div>
            <h2 className="text-3xl font-bold mb-2">Soy un Equipo</h2>
            <p className="text-gray-400">Unirme a una sala existente para tomar decisiones.</p>
          </button>
        </div>
      </div>
    );
  }

  // --- Pantalla: Jugador ingresando su nombre ---
  if (role === 'player_select') {
    if (gameData?.status === 'waiting_host') {
      return (
        <div className="min-h-screen bg-[#0B132B] text-white p-8 flex flex-col items-center justify-center text-center">
          <Clock size={64} className="text-gray-500 mb-6 animate-pulse" />
          <h2 className="text-3xl font-bold mb-4">Sala no disponible</h2>
          <p className="text-xl text-gray-400 max-w-md">El facilitador aún no ha creado la sala principal. Dile que seleccione "Soy Facilitador".</p>
          <button onClick={() => setRole(null)} className="mt-12 text-gray-500 hover:text-white">Volver al inicio</button>
        </div>
      );
    }

    if (gameData?.status !== 'setup') {
      return (
         <div className="min-h-screen bg-[#0B132B] text-white p-8 flex flex-col items-center justify-center text-center">
          <AlertCircle size={64} className="text-orange-500 mb-6" />
          <h2 className="text-3xl font-bold mb-4">El juego ya comenzó</h2>
          <p className="text-xl text-gray-400 max-w-md">La dinámica ya está en curso (Ronda {gameData?.currentRound}). No es posible unirse ahora.</p>
          <button onClick={() => setRole(null)} className="mt-12 text-gray-500 hover:text-white">Volver al inicio</button>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-[#0B132B] text-white p-4 md:p-8 flex flex-col items-center justify-center font-sans">
        <div className="bg-[#1A1B41] p-8 md:p-12 rounded-3xl border border-[#2E3192] shadow-2xl max-w-md w-full text-center">
          <h2 className="text-3xl font-bold mb-2">Únete a la Dinámica</h2>
          <p className="text-gray-400 mb-8">Escribe el nombre de tu área o de tu equipo para registrarte.</p>
          
          <form onSubmit={joinAsTeam} className="space-y-6">
            <input
              type="text"
              required
              maxLength={20}
              placeholder="Ej: Equipo Finanzas"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              className="w-full bg-[#050814] border-2 border-gray-700 focus:border-blue-500 rounded-xl px-6 py-4 text-xl font-bold text-center text-white outline-none transition-colors"
            />
            <button 
              type="submit"
              disabled={!joinName.trim()}
              className="w-full bg-blue-500 hover:bg-blue-400 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold py-4 rounded-xl text-lg flex justify-center items-center gap-2 transition-all"
            >
              <Plus size={24} /> Registrar Equipo
            </button>
          </form>
        </div>
        <button onClick={() => setRole(null)} className="mt-8 text-gray-500 hover:text-white">Cancelar</button>
      </div>
    );
  }

  if (!gameData || gameData.status === 'waiting_host') {
    return <div className="min-h-screen bg-[#0B132B] flex items-center justify-center text-white text-xl">Sincronizando con la sala principal...</div>;
  }

  // Helpers
  const isNegotiationRound = gameData.currentRound === 3;
  const isTripleRound = gameData.currentRound === 5;
  const currentMultiplier = isTripleRound ? 3 : 2;
  const maxScore = Math.max(...(gameData.teams || []).map(t => t.score), 1);
  const allTeamsReady = (gameData.teams || []).length > 0 && (gameData.teams || []).every(team => gameData.inputStatus[team.id] === true);
  const myTeam = role === 'player' ? (gameData.teams || []).find(t => t.id === teamId) : null;
  const myInputStatus = role === 'player' ? gameData.inputStatus[teamId] : false;

  const Header = ({ isFacilitator }) => (
    <header className="flex flex-wrap gap-4 justify-between items-center mb-8 border-b border-gray-800 pb-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-white tracking-wide flex items-center gap-3">
          Sinergia <span className="text-orange-500">Corp</span>
          {isFacilitator ? 
            <span className="bg-gray-800 text-xs px-2 py-1 rounded text-gray-400 font-normal">FACILITADOR</span> :
            <span className={`text-xs px-3 py-1 rounded-full font-bold text-white ${myTeam?.color}`}>{myTeam?.name}</span>
          }
        </h1>
      </div>
      {gameData.status !== 'setup' && gameData.status !== 'end' && (
        <div className="flex items-center gap-4">
          {isFacilitator && isNegotiationRound && (
            <span className="hidden md:flex bg-blue-500/20 text-blue-400 px-4 py-2 rounded-full text-sm font-bold animate-pulse items-center gap-2">
              <Users size={16} /> NEGOCIACIÓN
            </span>
          )}
          {isFacilitator && isTripleRound && (
            <span className="hidden md:flex bg-purple-500/20 text-purple-400 px-4 py-2 rounded-full text-sm font-bold animate-pulse items-center gap-2">
              <TrendingUp size={16} /> MULTIPLICADOR x3
            </span>
          )}
          <div className="bg-[#1A1B41] px-4 py-2 rounded-lg border border-[#2E3192] flex items-center gap-3">
            <span className="text-gray-400 text-sm uppercase tracking-wider">Ronda</span>
            <div className="text-xl font-bold text-white">{gameData.currentRound} / {TOTAL_ROUNDS}</div>
          </div>
        </div>
      )}
    </header>
  );

  // ==========================================
  // VIEW: PLAYER (MOBILE OPTIMIZED)
  // ==========================================
  if (role === 'player') {
    return (
      <div className="min-h-screen bg-[#0B132B] text-white p-4 md:p-8 font-sans">
        <div className="max-w-md mx-auto">
          <Header isFacilitator={false} />

          {gameData.status === 'setup' && (
            <div className="bg-[#1A1B41] p-8 rounded-2xl border border-green-500/30 text-center animate-in slide-in-from-bottom-4">
              <CheckCircle2 size={64} className="mx-auto text-green-500 mb-4" />
              <h3 className="text-2xl font-bold mb-2">¡Equipo Registrado!</h3>
              <p className="text-gray-400 mb-6">Miren la pantalla principal. Su equipo ya está en la lista de jugadores.</p>
              
              <div className="bg-blue-500/10 border border-blue-500/30 p-4 rounded-xl text-sm text-blue-200 flex flex-col items-center gap-2">
                <Clock size={20} className="animate-pulse text-blue-400" /> 
                <span>Esperando a que el facilitador inicie la Ronda 1...</span>
              </div>
            </div>
          )}

          {gameData.status === 'playing' && !myInputStatus && (
            <div className="bg-[#1A1B41] p-6 md:p-8 rounded-2xl border border-[#2E3192] shadow-2xl animate-in slide-in-from-bottom-4">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold mb-2">Tu Decisión</h2>
                <p className="text-gray-400">¿Cuántas fichas invertirás en el fondo común esta ronda?</p>
                {isTripleRound && <div className="mt-3 inline-block bg-purple-500/20 text-purple-400 px-3 py-1 rounded-full text-sm font-bold">¡Esta ronda multiplica x3!</div>}
              </div>

              <div className="flex justify-center items-center gap-6 mb-8">
                <button 
                  onClick={() => setPlayerInput(Math.max(0, playerInput - 1))}
                  className="w-14 h-14 rounded-full bg-gray-800 text-3xl font-bold active:bg-gray-700 transition-colors flex justify-center items-center"
                >-</button>
                <div className="text-6xl font-black text-orange-500 w-20 text-center select-none">{playerInput}</div>
                <button 
                  onClick={() => setPlayerInput(Math.min(INITIAL_TOKENS, playerInput + 1))}
                  className="w-14 h-14 rounded-full bg-gray-800 text-3xl font-bold active:bg-gray-700 transition-colors flex justify-center items-center"
                >+</button>
              </div>

              <div className="flex justify-between text-sm text-gray-400 border-t border-gray-800 pt-4 mb-8 px-4">
                <div className="text-center">
                  <span className="block font-bold text-white text-lg">{INITIAL_TOKENS - playerInput}</span>
                  Privado
                </div>
                <div className="text-center">
                  <span className="block font-bold text-orange-500 text-lg">{playerInput}</span>
                  Fondo Común
                </div>
              </div>

              <button 
                onClick={submitPlayerDecision}
                className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${playerInput > 0 ? 'bg-orange-500 text-white shadow-[0_0_15px_rgba(255,91,34,0.4)]' : 'bg-gray-700 text-gray-300'}`}
              >
                Enviar Decisión Oculta
              </button>
            </div>
          )}

          {gameData.status === 'playing' && myInputStatus && (
            <div className="bg-[#1A1B41] p-8 rounded-2xl border border-green-500/30 text-center">
              <CheckCircle2 size={64} className="mx-auto text-green-500 mb-4" />
              <h3 className="text-2xl font-bold mb-2 text-white">Decisión Enviada</h3>
              <p className="text-gray-400">Has enviado {gameData.currentInputs[teamId]} fichas al fondo.</p>
              <p className="text-sm text-gray-500 mt-6 flex items-center justify-center gap-2">
                <Clock size={16} className="animate-spin-slow" /> Esperando a los demás equipos...
              </p>
            </div>
          )}

          {gameData.status === 'reveal' && (
             <div className="bg-[#1A1B41] p-8 rounded-2xl border border-[#2E3192] text-center animate-in slide-in-from-bottom-4">
                <Eye size={48} className="mx-auto text-blue-500 mb-4" />
                <h3 className="text-2xl font-bold mb-2">¡Ronda Completada!</h3>
                <p className="text-gray-400 mb-6">Mira la pantalla principal del facilitador para ver los resultados globales.</p>
                <div className="bg-[#0B132B] p-4 rounded-xl">
                  <span className="text-gray-500 text-sm block mb-1">Tu puntaje acumulado:</span>
                  <span className="text-3xl font-black text-white">{myTeam?.score.toFixed(1)}</span>
                </div>
             </div>
          )}

          {gameData.status === 'end' && (
            <div className="bg-[#1A1B41] p-8 rounded-2xl border border-yellow-500/50 text-center">
                <Trophy size={64} className="mx-auto text-yellow-500 mb-4" />
                <h3 className="text-3xl font-black mb-2">Simulación Terminada</h3>
                <p className="text-gray-400">Atención a la pantalla principal para la reflexión final.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW: FACILITATOR (DESKTOP OPTIMIZED)
  // ==========================================
  return (
    <div className="min-h-screen bg-[#0B132B] text-white p-8 font-sans selection:bg-orange-500/30">
      <div className="max-w-6xl mx-auto">
        <Header isFacilitator={true} />

        {/* SETUP PHASE */}
        {gameData.status === 'setup' && (
          <div className="bg-[#1A1B41] p-10 rounded-2xl border border-[#2E3192] shadow-2xl max-w-3xl mx-auto text-center">
            <TrendingUp size={64} className="mx-auto text-orange-500 mb-6" />
            <h2 className="text-4xl font-bold mb-4">Sala de Espera</h2>
            <p className="text-gray-400 mb-8 text-lg">
              Pide a los equipos que ingresen a este enlace desde sus celulares y escriban su nombre de equipo. Aparecerán aquí automáticamente:
            </p>
            
            <div className="bg-[#050814] border border-gray-800 rounded-xl p-8 mb-4 min-h-[150px] flex items-center justify-center">
              {(gameData.teams || []).length === 0 ? (
                <div className="text-gray-500 flex flex-col items-center">
                  <Clock size={40} className="mb-4 animate-spin-slow opacity-50" />
                  <p>Nadie se ha unido todavía...</p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-4 justify-center w-full">
                  {(gameData.teams || []).map(team => (
                    <div key={team.id} className="animate-in zoom-in duration-300 bg-[#1A1B41] border border-gray-700 px-6 py-3 rounded-full flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${team.color}`}></div>
                      <span className="font-bold text-lg">{team.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Aviso crucial para UX del facilitador */}
            {(gameData.teams || []).length > 0 && (
              <div className="bg-orange-500/10 border border-orange-500/30 p-4 rounded-xl mb-8 animate-in fade-in">
                <p className="text-orange-400 font-bold mb-1">¡Equipos conectados!</p>
                <p className="text-sm text-gray-300">Ellos seguirán viendo un mensaje de "espera" en sus celulares hasta que tú hagas clic en Iniciar Dinámica.</p>
              </div>
            )}

            <button 
              onClick={startGame}
              disabled={(gameData.teams || []).length < 1}
              className={`font-bold py-4 px-12 rounded-full text-xl transition-all transform hover:scale-105 ${(gameData.teams || []).length >= 1 ? 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white shadow-[0_0_20px_rgba(255,91,34,0.4)]' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}
            >
              Iniciar Dinámica ({(gameData.teams || []).length} Equipos)
            </button>
          </div>
        )}

        {/* PLAYING PHASE (Monitoring inputs) */}
        {gameData.status === 'playing' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                  Estado de Decisiones
                </h2>
                <span className="text-gray-400 bg-gray-800 px-3 py-1 rounded-full text-sm">
                  {Object.values(gameData.inputStatus).filter(Boolean).length} / {(gameData.teams || []).length} Equipos listos
                </span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(gameData.teams || []).map(team => {
                  const isReady = gameData.inputStatus[team.id];
                  return (
                    <div key={team.id} className={`bg-[#1A1B41] p-5 rounded-xl border transition-colors flex flex-col justify-between h-32 ${isReady ? 'border-green-500/50 bg-green-900/10' : 'border-[#2E3192]'}`}>
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`w-4 h-4 rounded-full ${team.color}`}></div>
                        <h3 className="text-xl font-bold truncate" title={team.name}>{team.name}</h3>
                      </div>
                      <div className="mt-auto">
                        {isReady ? (
                           <div className="flex items-center gap-2 text-green-400 font-bold bg-green-500/10 px-3 py-2 rounded-lg text-sm w-fit">
                             <CheckCircle2 size={16} /> Decisión Oculta
                           </div>
                        ) : (
                           <div className="flex items-center gap-2 text-gray-400 bg-gray-800 px-3 py-2 rounded-lg text-sm w-fit">
                             <Clock size={16} className="animate-spin-slow" /> Pensando...
                           </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-8 flex justify-end">
                <button 
                  onClick={calculateRound}
                  disabled={!allTeamsReady}
                  className={`font-bold py-4 px-10 rounded-xl text-lg transition-all flex items-center gap-2 ${allTeamsReady ? 'bg-blue-500 hover:bg-blue-400 text-white shadow-[0_0_15px_rgba(0,196,255,0.4)]' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}
                >
                  Revelar Ronda <ChevronRight />
                </button>
              </div>
            </div>

            {/* Side Panel - Current Standings Mini */}
            <div className="bg-[#050814] p-6 rounded-2xl border border-gray-800 h-fit">
              <h3 className="text-xl font-bold mb-6 flex items-center gap-2"><Trophy className="text-orange-500"/> Ranking Actual</h3>
              <div className="space-y-4">
                {[...(gameData.teams || [])].sort((a,b) => b.score - a.score).map((team, idx) => (
                  <div key={team.id} className="flex flex-col gap-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-300 truncate max-w-[150px]" title={team.name}>{idx + 1}. {team.name}</span>
                      <span className="font-bold text-white whitespace-nowrap">{team.score.toFixed(1)} pts</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2">
                      <div className={`h-2 rounded-full ${team.color}`} style={{ width: `${(team.score / maxScore) * 100}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* REVEAL PHASE (Results) */}
        {gameData.status === 'reveal' && gameData.roundResult && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <h2 className="text-3xl font-bold text-center mb-8">Resultados de la Ronda {gameData.currentRound}</h2>
            
            {/* The Math Dashboard */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-[#1A1B41] p-6 rounded-2xl border border-gray-700 text-center flex flex-col justify-center">
                <p className="text-gray-400 text-lg mb-2">Total Invertido (Fondo)</p>
                <div className="text-5xl font-bold text-white">{gameData.roundResult.totalInvested}</div>
                <p className="text-sm text-gray-500 mt-2">de {INITIAL_TOKENS * (gameData.teams || []).length} posibles</p>
              </div>
              
              <div className="bg-gradient-to-br from-[#2E3192] to-[#9D4EDD] p-6 rounded-2xl text-center transform scale-105 shadow-2xl flex flex-col justify-center relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-20"><TrendingUp size={64}/></div>
                <p className="text-blue-200 text-lg mb-2 relative z-10">Fondo Multiplicado (x{currentMultiplier})</p>
                <div className="text-6xl font-black text-white relative z-10">{gameData.roundResult.multipliedFund}</div>
              </div>
              
              <div className="bg-[#1A1B41] p-6 rounded-2xl border border-gray-700 text-center flex flex-col justify-center">
                <p className="text-gray-400 text-lg mb-2">Retorno por Equipo</p>
                <div className="text-5xl font-bold text-green-400">+{gameData.roundResult.payoutPerTeam.toFixed(1)}</div>
                <p className="text-sm text-gray-500 mt-2">Para todos por igual</p>
              </div>
            </div>

            {/* Details Table */}
            <div className="bg-[#1A1B41] rounded-2xl border border-[#2E3192] overflow-x-auto mt-8">
              <table className="w-full text-left min-w-[600px]">
                <thead className="bg-[#0B132B]">
                  <tr>
                    <th className="p-4 text-gray-400 font-medium">Equipo</th>
                    <th className="p-4 text-gray-400 font-medium text-center">Inversión<br/>(Fondo)</th>
                    <th className="p-4 text-gray-400 font-medium text-center">Retención<br/>(Privado)</th>
                    <th className="p-4 text-gray-400 font-medium text-center">Ganancia<br/>Ronda</th>
                    <th className="p-4 text-gray-400 font-medium text-right">Puntaje Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {gameData.roundResult.details.map(team => (
                    <tr key={team.id} className="hover:bg-gray-800/50 transition-colors">
                      <td className="p-4 font-bold flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full shrink-0 ${team.color}`}></div>
                        <span className="truncate max-w-[200px]" title={team.name}>{team.name}</span>
                      </td>
                      <td className="p-4 text-center">
                        <span className={`text-xl font-bold ${team.invested >= 7 ? 'text-green-400' : team.invested <= 3 ? 'text-red-400' : 'text-white'}`}>
                          {team.invested}
                        </span>
                      </td>
                      <td className="p-4 text-center text-gray-300">{team.kept}</td>
                      <td className="p-4 text-center font-bold text-green-400">
                        +{(team.kept + gameData.roundResult.payoutPerTeam).toFixed(1)}
                      </td>
                      <td className="p-4 text-right font-black text-2xl text-white">
                        {(gameData.teams || []).find(t => t.id === team.id).score.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-center mt-8">
              <button 
                onClick={nextRound}
                className="bg-orange-500 hover:bg-orange-400 text-white font-bold py-4 px-12 rounded-full text-xl transition-all shadow-[0_0_20px_rgba(255,91,34,0.4)]"
              >
                {gameData.currentRound >= TOTAL_ROUNDS ? 'Ver Resultados Finales' : `Iniciar Ronda ${gameData.currentRound + 1}`}
              </button>
            </div>
          </div>
        )}

        {/* END PHASE */}
        {gameData.status === 'end' && (
          <div className="animate-in zoom-in-95 duration-500 space-y-8">
            <div className="text-center mb-12">
              <Trophy size={80} className="mx-auto text-yellow-500 mb-6" />
              <h2 className="text-5xl font-black text-white mb-4">Simulación Completada</h2>
              <p className="text-xl text-gray-400">Evaluación de la Sinergia Corporativa</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              {/* Podium */}
              <div className="bg-[#1A1B41] p-8 rounded-2xl border border-[#2E3192]">
                <h3 className="text-2xl font-bold mb-6 text-orange-500">Ranking Final</h3>
                <div className="space-y-6">
                  {[...(gameData.teams || [])].sort((a,b) => b.score - a.score).map((team, idx) => (
                    <div key={team.id} className="relative">
                      <div className="flex justify-between items-end mb-2">
                        <span className="font-bold text-lg flex items-center gap-2">
                          <span className="text-gray-500 text-sm shrink-0">#{idx + 1}</span> 
                          <span className="truncate max-w-[200px]" title={team.name}>{team.name}</span>
                        </span>
                        <span className="font-black text-2xl shrink-0">{team.score.toFixed(1)} <span className="text-sm text-gray-500 font-normal">pts</span></span>
                      </div>
                      <div className="w-full bg-gray-800 rounded-full h-4 overflow-hidden">
                        <div 
                          className={`h-full ${team.color} transition-all duration-1000 ease-out`} 
                          style={{ width: `${(team.score / maxScore) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Data Insights */}
              <div className="bg-[#050814] p-8 rounded-2xl border border-gray-800 flex flex-col justify-center space-y-6">
                <h3 className="text-2xl font-bold mb-2 text-blue-400">Análisis del Consultor</h3>
                
                <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                  <div className="text-sm text-gray-400 mb-1">Máximo Potencial (Todos cooperan siempre)</div>
                  <div className="text-3xl font-bold text-white">
                    110.0 <span className="text-lg font-normal text-gray-500">pts por equipo</span>
                  </div>
                </div>

                <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                  <div className="text-sm text-gray-400 mb-1">Puntaje del Equipo Ganador</div>
                  <div className="text-3xl font-bold text-white">
                    {(gameData.teams || []).length > 0 ? Math.max(...(gameData.teams || []).map(t => t.score)).toFixed(1) : '0.0'} <span className="text-lg font-normal text-gray-500">pts</span>
                  </div>
                </div>

                <div className="mt-4 p-4 border-l-4 border-orange-500 bg-orange-500/10 text-orange-100">
                  <AlertCircle className="inline mb-1 mr-2" size={18} />
                  <strong>Reflexión:</strong> La diferencia entre el máximo potencial y el resultado real es el "costo de la desconfianza". El equipo que gana individualmente a menudo lo hace erosionando el valor de la organización.
                </div>
              </div>
            </div>

            <div className="text-center mt-12">
              <button 
                onClick={resetGame}
                className="text-gray-400 hover:text-white flex items-center gap-2 mx-auto transition-colors"
              >
                <RotateCcw size={18} /> Reiniciar Taller (Desconectar a todos)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}