import {createLiveGameRound} from '@/lib/live-game-round';
import {registerRoundContract} from '../../../tests/contracts/live-game-round';
registerRoundContract(createLiveGameRound);
