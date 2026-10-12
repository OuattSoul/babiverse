class GameError(Exception):
    """Refus métier d'une action (solde insuffisant, trop loin, déjà fait...)."""

    def __init__(self, code, message, status=409):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
