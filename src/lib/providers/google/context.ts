import { StrategyContext } from './types';

export interface GoogleAccountContextProvider {
  getStrategyContext(ownerId: string): Promise<StrategyContext>;
}
