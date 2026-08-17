import { StrategyContext } from './types';
import { GoogleAccountContextProvider } from './context';

export class MockGoogleAccountContextProvider implements GoogleAccountContextProvider {
  constructor(private mockContext: StrategyContext) {}

  async getStrategyContext(ownerId: string): Promise<StrategyContext> {
    return this.mockContext;
  }
}
