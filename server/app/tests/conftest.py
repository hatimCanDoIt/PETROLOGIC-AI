"""Shared pytest fixtures.

We build a synthetic LAS file in-memory so tests don't depend on any external
data file. The fixture intentionally includes:
  * a clean GR section + a shaly section so Vsh spans the full range
  * an oil-bearing high-resistivity zone
  * a gas zone with a strong neutron-density crossover
  * a few NULL (-999.25) sentinels to exercise the null-cleaning path
"""

from __future__ import annotations

import asyncio
import textwrap
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import database
from app.database import Base, get_db
from app.main import app


@pytest.fixture(scope="module")
def client():
    # Use a file-backed sqlite so the same engine survives across the test.
    db_file = Path("./_test_petrologic.sqlite")
    if db_file.exists():
        db_file.unlink()

    test_url = f"sqlite+aiosqlite:///{db_file.resolve().as_posix()}"
    test_engine = create_async_engine(test_url, future=True)
    test_session = async_sessionmaker(test_engine, expire_on_commit=False)

    database.engine = test_engine
    database.AsyncSessionLocal = test_session

    async def _override():
        async with test_session() as s:
            try:
                yield s
            finally:
                await s.close()

    app.dependency_overrides[get_db] = _override

    async def _init():
        async with test_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.get_event_loop().run_until_complete(_init())

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()
    if db_file.exists():
        db_file.unlink()


def _synthetic_las_text(
    *,
    top: float = 8000.0,
    bot: float = 8200.0,
    step: float = 0.5,
) -> str:
    depth = np.arange(top, bot + step / 2, step)
    n = len(depth)

    # GR background (shale) ~ 110, with a clean sand 8050–8090 (~30), and
    # a clean carbonate 8120–8170 (~25)
    GR = np.full(n, 110.0)
    GR[(depth >= 8050) & (depth < 8090)] = 30.0
    GR[(depth >= 8120) & (depth < 8170)] = 25.0
    # add a little noise so percentiles don't degenerate
    rng = np.random.default_rng(7)
    GR = GR + rng.normal(0, 2, n)

    # NPHI: shale 0.40, sand (oil) 0.18, carbonate (gas crossover) 0.05
    NPHI = np.full(n, 0.40)
    NPHI[(depth >= 8050) & (depth < 8090)] = 0.18
    NPHI[(depth >= 8120) & (depth < 8170)] = 0.05
    NPHI = NPHI + rng.normal(0, 0.005, n)

    # RHOZ: shale 2.55, sand (oil) 2.40 → DPHI ~0.18, carbonate (gas) 2.30 → DPHI ~0.25
    RHOZ = np.full(n, 2.55)
    RHOZ[(depth >= 8050) & (depth < 8090)] = 2.40
    RHOZ[(depth >= 8120) & (depth < 8170)] = 2.30
    RHOZ = RHOZ + rng.normal(0, 0.005, n)

    # RT: shale 2.0, oil sand 50, gas carbonate 80
    RT = np.full(n, 2.0)
    RT[(depth >= 8050) & (depth < 8090)] = 50.0
    RT[(depth >= 8120) & (depth < 8170)] = 80.0

    # PEF: sand ~1.8, carbonate ~5.0
    PEF = np.full(n, 3.0)
    PEF[(depth >= 8050) & (depth < 8090)] = 1.8
    PEF[(depth >= 8120) & (depth < 8170)] = 5.0

    # Inject a few NULL sentinels at known depths
    null_idx = [10, 20, 30]
    for i in null_idx:
        GR[i] = -999.25
        NPHI[i] = -999.25

    header = textwrap.dedent(
        f"""\
        ~Version Information
         VERS.   2.0 : CWLS log ASCII Standard - VERSION 2.0
         WRAP.   NO  : One line per depth step
        ~Well Information Block
        #MNEM.UNIT       VALUE                  DESCRIPTION
        STRT.FT          {top:.4f}              : START DEPTH
        STOP.FT          {bot:.4f}              : STOP DEPTH
        STEP.FT          {step:.4f}             : STEP
        NULL.            -999.25                : NULL VALUE
        COMP.            TEST OPERATOR          : COMPANY
        WELL.            SYNTHETIC-1            : WELL
        FLD.             SYNTHETIC FIELD        : FIELD
        DATE.            2026-01-01             : LOG DATE
        API.             42-123-45678           : API
        ~Curve Information Block
        #MNEM.UNIT      API CODES   CURVE DESCRIPTION
        DEPT.FT                : 1  DEPTH
        GR.GAPI                : 2  GAMMA RAY
        NPHI.V/V               : 3  NEUTRON POROSITY
        RHOZ.G/CC              : 4  BULK DENSITY
        RT.OHMM                : 5  DEEP RESISTIVITY
        PEF.B/E                : 6  PHOTOELECTRIC FACTOR
        ~Parameter Information Block
        ~A  DEPT          GR        NPHI      RHOZ      RT        PEF
        """
    )

    rows = []
    for i in range(n):
        rows.append(
            f" {depth[i]:>10.4f}  {GR[i]:>8.3f}  {NPHI[i]:>8.4f}  {RHOZ[i]:>8.4f}"
            f"  {RT[i]:>8.3f}  {PEF[i]:>8.3f}"
        )
    return header + "\n".join(rows) + "\n"


@pytest.fixture(scope="session")
def synthetic_las_bytes() -> bytes:
    return _synthetic_las_text().encode("utf-8")


@pytest.fixture(scope="session")
def synthetic_las_text() -> str:
    return _synthetic_las_text()
