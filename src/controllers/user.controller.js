import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { User } from "../models/user.model.js"
import { uploadOnCloudinary } from "../utils/cloundinary.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import jwt from "jsonwebtoken"
import mongoose from "mongoose"

const generateAccessAndRefreshTokens = async (userId) => {
  try {
    const user = await User.findById(userId)
    // console.log(user)
    const accessToken = user.generateAccessToken()
    // console.log(accessToken)
    const refreshToken = user.generateRefreshToken()

    user.refreshToken = refreshToken
    await user.save({ validateBeforeSave: false })

    return { accessToken, refreshToken }
  } catch (error) {
    throw new ApiError(
      500,
      "Something went wrong while generation referesh and access token"
    )
  }
}

const registerUser = asyncHandler(async (req, res) => {
  // get user details from frontend
  const { fullName, email, username, password } = req.body
  // console.log("email: ", email)

  // validation - not empty
  if (
    [fullName, email, username, password].some((field) => field?.trim() === "")
  ) {
    throw new ApiError(400, "All fields are required")
  }

  // check if user already exists: username, email
  const existedUser = await User.findOne({
    $or: [{ username }, { email }],
  })

  if (existedUser) {
    throw new ApiError(409, "User with email or username already exist")
  }
  // console.log(req.files)

  // check for images, check for avtar
  const avatarLocalPath = req.files?.avatar[0]?.path
  // console.log(avatarLocalPath)
  // const coverImageLocalPath = req.files?.coverImage[0]?.path

  let coverImageLocalPath
  if (
    req.files &&
    Array.isArray(req.files.coverImage) &&
    req.files.coverImage.length > 0
  ) {
    coverImageLocalPath = req.files.coverImage[0].path
  }

  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is required")
  }

  // upload them to cloudinary, avatar
  const avatar = await uploadOnCloudinary(avatarLocalPath)
  const coverImage = await uploadOnCloudinary(coverImageLocalPath)

  //check for avtar
  // create user object -create entry in db
  if (!avatar) {
    throw new ApiError(400, "Avatar file is required")
  }

  // create user object -create entry in db
  const user = await User.create({
    fullName,
    avatar: avatar.url,
    coverImage: coverImage?.url || "",
    email,
    password,
    username: username.toLowerCase(),
  })

  // remove password and refresh token field from response
  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  )

  // check for user creation
  if (!createdUser) {
    throw new ApiError(500, "Something went wrong while registering the user")
  }

  //return res
  return res
    .status(201)
    .json(new ApiResponse(200, createdUser, "User registered Successfully"))
})

const loginUser = asyncHandler(async (req, res) => {
  // req body -> data
  const { email, password, username } = req.body
  // console.log(email)

  // username or email
  if (!username && !email) {
    throw new ApiError(400, "Username or email is required")
  }

  // find the user
  const user = await User.findOne({
    $or: [{ username }, { email }],
  })
  // console.log(user)

  if (!user) {
    throw new ApiError(404, "User does not exist")
  }

  // check password
  const isPasswordValid = await user.isPasswordCorrect(password)
  // console.log(isPasswordValid)

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid user credentials")
  }

  // access and referesh token
  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id
  )

  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken"
  )
  // console.log(loggedInUser)

  const options = {
    httpOnly: true,
    secure: true,
  }

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        {
          user: loggedInUser,
          accessToken,
          refreshToken,
        },
        "User logged In Successfully"
      )
    )
})

const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $unset: {
        refreshToken: 1, // this removes the field from document
      },
    },
    {
      new: true,
    }
  )

  const options = {
    httpOnly: true,
    secure: true,
  }

  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged Out"))
})

const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken = req.cookie.refreshToken || req.body.refreshToken

  if (incomingRefreshToken) {
    throw new ApiError(401, "Unauthorized request")
  }

  try {
    const decodedToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    )

    const user = await User.findById(decodedToken?._id)

    if (!user) {
      throw new ApiError(401, "Invalid refersh token")
    }

    if (!incomingRefreshToken !== user?.refershToken) {
      throw new ApiError(401, "Refresh token is expired or used")
    }

    const options = {
      httpOnly: true,
      secure: true,
    }

    const { accessToken, newrefreshToken } =
      await generateAccessAndRefreshTokens(user._id)

    return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refershToken", newrefreshTokenrefreshToken, options)
      .json(
        new ApiResponse(
          200,
          {
            accessToken,
            refreshToken: newrefreshToken,
          },
          "Access token refreshed"
        )
      )
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid refresh token")
  }
})

const changeCurrentPassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body

  const user = await User.findById(req.user?._id)

  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)

  if (!isPasswordCorrect) {
    throw new ApiError(400, "Invalid old password")
  }

  user.password = newPassword
  await user.save({ validateBeforeSave: false })

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password changed successfully"))
})

const getCurrentUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(200, req.user, "current user fetched successfully")
})

const updateAccountDetails = asyncHandler(async (req, res) => {
  const { fullName, email } = req.body

  if (!fullName || !email) {
    throw new ApiError(400, "All field are required")
  }

  const user = await User.findById(
    req.user?._id,
    {
      $set: {
        fullName,
        email,
      },
    },
    {
      new: true,
    }
  ).select(-password)

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated successfully"))
})

const updateUserAvatar = asyncHandler(async (req, res) => {
  const avatarLocalPath = req.file?.path

  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is missing")
  }

  const avatar = await uploadOnCloudinary(avatarLocalPath)

  if (!avatar.url) {
    throw new ApiError(400, "Error while uploading on avatar")
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        avatar: avatar.url,
      },
    },
    {
      new: true,
    }
  ).select(-password)

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Avatar image updated successfully"))
})

const updateUserCoverImage = asyncHandler(async (req, res) => {
  const coverImageLocalPath = req.file?.path

  if (!coverImageLocalPath) {
    throw new ApiError(400, "Cover Image file is missing")
  }

  const coverImage = await uploadOnCloudinary(coverImageLocalPath)

  if (!coverImage.url) {
    throw new ApiError(400, "Error while uploading on coverImage")
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        coverImage: coverImage.url,
      },
    },
    {
      new: true,
    }
  ).select(-password)

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Cover image updated successfully"))
})

const getUserChannelProfile = asyncHandler(async (req, res) => {
  const { username } = req.params

  if (!username?.trim()) {
    throw new ApiError(400, "username is messing")
  }

  const channel = await User.aggregate([
    {
      $match: {
        username: username?.toLowerCase(),
      },
    },
    {
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "channel",
        as: "subscribers",
      },
    },
    {
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "subscriber",
        as: "subscribedTo",
      },
    },
    {
      $addFields: {
        subscribersCount: {
          $size: "$subscribers",
        },
        channelsSubscribedToCount: {
          $size: "$subscribedTo",
        },
        isSubscribed: {
          $cond: {
            if: {
              $in: [req.user?._id, "$subscribers.subscriber"],
            },
            then: true,
            else: false,
          },
        },
      },
    },
    {
      $project: {
        fullName: 1,
        username: 1,
        subscribersCount: 1,
        channelsSubscribedToCount: 1,
        isSubscribed: 1,
        avatar: 1,
        coverImage: 1,
        email: 1,
      },
    },
  ])

  if (!channel?.length) {
    throw new ApiError(404, "channel does not exists")
  }

  return res
    .status(200)
    .json(
      new ApiResponse(200, channel[0], "User channel fetched successfully")
    )
})

const getWatchHistory = asyncHandler(async (req, res) => {
  const user = await User.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(user._id),
      },
    },
    {
      $lookup: {
        from: "videos",
        localField: "watchHistory",
        foreignField: "_id",
        as: "watchHistory",
        pipeline: [
          //sub pipline
          {
            $lookup: {
              from: "users",
              localField: "owner",
              foreignField: "_id",
              as: "owner",
              pipeline: [
                {
                  $project: {
                    fullName: 1,
                    username: 1,
                    avatar: 1,
                  },
                },
              ],
            },
          },
          {
            $addFields: {
              owner: {
                $first: "$owner",
              },
            },
          },
        ],
      },
    },
  ])

  return res
  .status(200)
  .json(new ApiResponse(200, user[0].watchHistory, "Watch history fetched successfully"))
})

export {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateAccountDetails,
  updateUserAvatar,
  updateUserCoverImage,
  getUserChannelProfile,
  getWatchHistory,
}
