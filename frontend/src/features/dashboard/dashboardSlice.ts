import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import { toDateInputValue } from '../../utils/date'

type DashboardState = {
  reportDate: string
}

const initialState: DashboardState = {
  reportDate: toDateInputValue(new Date()),
}

const dashboardSlice = createSlice({
  name: 'dashboard',
  initialState,
  reducers: {
    reportDateChanged: (state, action: PayloadAction<string>) => {
      state.reportDate = action.payload
    },
  },
})

export const { reportDateChanged } = dashboardSlice.actions
export default dashboardSlice.reducer
