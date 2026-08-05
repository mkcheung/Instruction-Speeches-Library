<?php
require_once("constants.php");
require_once("function.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("Club.php");
require_once("database.php");
require_once("user.php");
require_once("userrole.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

$errors = array();
	$required_fields = array('editUserForm_username','editUserForm_first_name','editUserForm_last_name','editUserForm_hashed_password', 'editUserForm_email', 'editUserForm_role', 'editUserForm_club');



if(isset($_POST['userid'])){
	$user_id = $_POST['userid'];     
	$user = User::find_by_id($user_id);
	$userRoles = UserRole::find_all();
	$users = User::find_all();
	$clubs = Club::find_all();
?>

<!-- Load existing values for examination -->
<script>
	var currentUserName = '<?=$user->username?>';
	var currentEmail = '<?=$user->email?>';
	// javascript variables
	var validClubs = Array();
	var clubAndPassword = Array();

	// Load existing values for examination 

	var editUsers_existingUserEmails = Array();
	var editUsers_existingUserUserNames = Array();
	<?php 
		foreach($users as $aUser){
	?>
		editUsers_existingUserEmails.push('<?=$aUser->email?>');
		editUsers_existingUserUserNames.push('<?=$aUser->username?>');
	<?php
		}
	?>
</script>
<script src='validator.js'></script>
		<div id="registration">
			<form action="editUser.php" method="post" id="editUserForm">
				<fieldset>
					<legend>Edit User Details:</legend>
					<div class="row-fluid">
						<div class="span6">
							<input type="hidden" id="id" name="id" value="<?=$user->id?>"/>
							<label for="editUserForm_first_name">First Name:</label>
							<input class="text" type="text" id="editUserForm_first_name" name="editUserForm_first_name" value="<?=$user->first_name?>"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
						<div class="span6">
							<label for="editUserForm_last_name">Last Name:</label>
							<input class="text" type="text" id="editUserForm_last_name" name="editUserForm_last_name" value="<?=$user->last_name?>"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
					</div>
					<div class="row-fluid">
						<div class="span6">
							<label for="editUserForm_username">User Name:</label>
							<input class="text" type="text" id="editUserForm_username" name="editUserForm_username" value="<?=$user->username?>"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
						<div class="span6">
							<label for="editUserForm_email">Email:</label>
							<input class="text" type="editUserForm_email" id="editUserForm_email" name="editUserForm_email" value="<?=$user->email?>"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
					</div>
					<div class="row-fluid">
						<div class="span6">
							<label for="editUserForm_hashed_password">Password:</label>
							<input class="text" type="password" id="editUserForm_hashed_password" name="editUserForm_hashed_password" value="<?=$user->hashed_password?>"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
						<div class="span6">
							<label for="editUserForm_passwordConfirmation">Password Confirmation:</label>
							<input class="text" type="password" name="editUserForm_passwordConfirmation" id="editUserForm_passwordConfirmation" value="<?=$user->passwordConfirmation?>"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
					</div>
					<div class="row-fluid">
						<div class="span6">
							<label for="editUserForm_club">Club:</label>
							<select id="editUserForm_club" name="editUserForm_club">
							<?php 
								foreach($clubs as $club) {
							?>
								<script>
									validClubs.push('<?=$club->id?>');
									clubAndPassword.push('<?=$club->password?>');
								</script>
								<option value="<?=$club->id?>"><?=$club->name?></option>
							<?php
								}
							?>
							</select>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
						<div class="span6">
							<label for="editUserForm_clubPassword">Club Password:</label>
							<input class="text" type="password" name="editUserForm_clubPassword" id="editUserForm_clubPassword"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
					</div>
					<div class="row-fluid">
						<div class="span6">
								<label for="editUserForm_role">User Role:</label>
								<select id="editUserForm_role" name="editUserForm_role">
								<?php 
									foreach($userRoles as $userRole) {
										if($userRole->id == $user->user_role_id) {
								?>
											<option value="<?=$userRole->id?>" selected><?=$userRole->role?></option>
								<?php
										} else {
								?>
											<option value="<?=$userRole->id?>"><?=$userRole->role?></option>
								<?php
										} 
									}
								?>
								</select>
								<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
						<div class="span6">
						</div>
					</div>
						<input type="hidden" id="submit2" name="submit"/>
						<div class='row-fluid'>
							<div class='span6'>
								<input id="editUserSubmit" type="submit" name="submit" class="btn btn-primary"/>
								<script>

									$('#editUserForm select').change(function(){
										var id = $(this).attr('id');
										var currentSelectedValue = $(this).val();
										// console.log(currentSelectedValue);

										switch(id){
											case 'editUserForm_role' :
												if((currentSelectedValue < 1) || (currentSelectedValue > 4)){
													$('form[id="editUserForm"] #editUserForm_role').next('div[class="validation"]').text('Please select a proper user role.');
												} else {
													$('form[id="editUserForm"] #editUserForm_role').next('div[class="validation"]').text('');	
												}		
												break;
											case 'editUserForm_club' :
												if((currentSelectedValue < 3) || (currentSelectedValue > 3)){
													$('form[id="editUserForm"] #editUserForm_club').next('div[class="validation"]').text('Invalid club selected.');
												} else {
													$('form[id="editUserForm"] #editUserForm_club').next('div[class="validation"]').text('');	
												}		
												break;
										}

										// $('#uploadTopic_topic_title').val('');
										// $('#uploadTopic_topic_title').next().text('');
										// $('#uploadTopic_description').val('');
										// $('#uploadTopic_description').next().text('');
										// $('#uploadTopic_topic_date').val('');
										// $('#uploadTopic_topic_date').next().text('');
									});

									$('#editUserForm input').blur(function(e){
										e.preventDefault();
										e.stopPropagation();
										var id = $(this).attr('id');
										var value = $(this).val();
										var emailPattern = /[a-zA-Z0-9]*@[a-zA-Z0-9]*\.[com]/;
										console.log(id);
										console.log(value);
										switch(id){
											case 'editUserForm_username' :
												if(value.length == 0){
													$('#editUserForm_username').next('div[class="validation"]').text('Username is required.');
												} else if ((jQuery.inArray(value, editUsers_existingUserUserNames) >= 0) && (currentUserName != editUsers_existingUserUserNames[(jQuery.inArray(value, editUsers_existingUserUserNames))])) {
													$('#editUserForm_username').next('div[class="validation"]').text('This user name has been taken.');
												} else {
													$('#editUserForm_username').next('div[class="validation"]').text('');	
												}
												break;
											case 'editUserForm_first_name' :
												if(value.length == 0){
													$('#editUserForm_first_name').next('div[class="validation"]').text('A First Name is required.');
												} else {
													$('#editUserForm_first_name').next('div[class="validation"]').text('');	
												}
												break;
											case 'editUserForm_last_name' :
												if(value.length == 0){
													$('#editUserForm_last_name').next('div[class="validation"]').text('A Last Name is required.');
												} else {
													$('#editUserForm_last_name').next('div[class="validation"]').text('');	
												}
												break;
											case 'editUserForm_email' :
												if(value.length == 0){
													$('#editUserForm_email').next('div[class="validation"]').text('Email is required.');
												} else if ((value.length > 0) && (!emailPattern.test(value))){
													$('#editUserForm_email').next('div[class="validation"]').text('Proper email format required.');
												} else if ((jQuery.inArray(value, editUsers_existingUserEmails) >= 0) && (currentEmail != editUsers_existingUserEmails[(jQuery.inArray(value, editUsers_existingUserEmails))])) {
													$('#editUserForm_email').next('div[class="validation"]').text('This email has been taken.');
												} else {
													$('#editUserForm_email').next('div[class="validation"]').text('');	
												}
												break;
											case 'editUserForm_hashed_password' :
												if(value.length == 0){
													$('#editUserForm_hashed_password').next('div[class="validation"]').text('Password is required.');
												} else {
													$('#editUserForm_hashed_password').next('div[class="validation"]').text('');	
												}
												break;
											case 'editUserForm_passwordConfirmation' :
												if(value.length == 0){
													$('#editUserForm_passwordConfirmation').next('div[class="validation"]').text('Password Confirmation is required.');
												} else {
													$('#editUserForm_passwordConfirmation').next('div[class="validation"]').text('');	
												}
												break;
											case 'editUserForm_clubPassword' :
												if(value.length == 0){
													$('#editUserForm_clubPassword').next('div[class="validation"]').text('A club password is required.');
												} else {
													$('#editUserForm_clubPassword').next('div[class="validation"]').text('');	
												}
												break;
											default: 
												break;
										}
									});
									$('#editUserSubmit').click(function(e){
										e.preventDefault();
										e.stopPropagation();
										// console.log(validClubs+' '+clubAndPassword+' '+currentUserName+' '+currentEmail+' '+editUsers_existingUserUserNames+' '+editUsers_existingUserEmails);
										validatorInstance.collectUserDataForEditing(validClubs, clubAndPassword, currentUserName, currentEmail, editUsers_existingUserUserNames,editUsers_existingUserEmails);
									});
									/*
									$('#editUserSubmit').click(function(e){
										e.preventDefault();
										e.stopPropagation();

										var editUserFields = {};
										var valid = '';
										var errorDisplay = '' ;
										var required = ' is required.';

										editUserFields.username = $('form[id="editUserForm"] #editUserForm_username').val();
										editUserFields.firstname = $('form[id="editUserForm"] #editUserForm_first_name').val();
										editUserFields.lastname = $('form[id="editUserForm"] #editUserForm_last_name').val();
										editUserFields.email = $('form[id="editUserForm"] #editUserForm_email').val();
										editUserFields.emailPattern = /[a-zA-Z0-9]*@[a-zA-Z0-9]*\.[com]/;								
										editUserFields.password = $('form[id="editUserForm"] #editUserForm_hashed_password').val();
										editUserFields.passwordConfirmation = $('form[id="editUserForm"] #editUserForm_passwordConfirmation').val();
										editUserFields.club = $('form[id="editUserForm"] #editUserForm_club').val();
										editUserFields.clubPassword = $('form[id="editUserForm"] #editUserForm_clubPassword').val();
										editUserFields.role = $('form[id="editUserForm"] #editUserForm_role').val();

										// var valid = '';
										// var errorDisplay = '' ;
										// var required = ' is required.';
										// var username = $('form[id="editUserForm"] #editUserForm_username').val();
										// var firstname = $('form[id="editUserForm"] #editUserForm_first_name').val();
										// var lastname = $('form[id="editUserForm"] #editUserForm_last_name').val();
										// var email = $('form[id="editUserForm"] #editUserForm_email').val();
										// var emailPattern = /[a-zA-Z0-9]*@[a-zA-Z0-9]*\.[com]/;								
										// var password = $('form[id="editUserForm"] #editUserForm_hashed_password').val();
										// var passwordConfirmation = $('form[id="editUserForm"] #editUserForm_passwordConfirmation').val();
										// var club = $('form[id="editUserForm"] #editUserForm_club').val();
										// var clubPassword = $('form[id="editUserForm"] #editUserForm_clubPassword').val();
										// var role = $('form[id="editUserForm"] #editUserForm_role').val();

										validatorInstance.validateUsers(editUserFields, validClubs, clubAndPassword, currentUserName, currentEmail, editUsers_existingUserUserNames,editUsers_existingUserEmails);

										// if(username == ''){
										// 	valid += '<p> Username is required. </p>';
										// 	$('form[id="editUserForm"] #editUserForm_username').next('div[class="validation"]').text('Username is required.');
										// } else if ((jQuery.inArray(username, editUsers_existingUserUserNames) >= 0) && (currentUserName != editUsers_existingUserUserNames[(jQuery.inArray(username, editUsers_existingUserUserNames))])) {
										// 	valid += '<p> This user name has been taken. </p>';
										// 	$('#editUserForm_username').next('div[class="validation"]').text('This user name has been taken.');
										// } else {
										// 	$('form[id="editUserForm"] #editUserForm_username').next('div[class="validation"]').text('');	
										// }

										// if(firstname == ''){
										// 	valid += '<p> A First Name is required. </p>';
										// 	$('form[id="editUserForm"] #editUserForm_first_name').next('div[class="validation"]').text('A First Name is required.');
										// } else {
										// 	$('form[id="editUserForm"] #editUserForm_first_name').next('div[class="validation"]').text('');	
										// }

										// if(lastname == ''){
										// 	valid += '<p> A Last Name is required. </p>';
										// 	$('form[id="editUserForm"] #editUserForm_last_name').next('div[class="validation"]').text('A Last Name is required.');
										// } else {
										// 	$('form[id="editUserForm"] #editUserForm_last_name').next('div[class="validation"]').text('');	
										// }

										// if(email == ''){
										// 	valid += '<p> Email is required. </p>';
										// 	$('form[id="editUserForm"] #editUserForm_email').next('div[class="validation"]').text('Email is required.');
										// } else if ((email.length > 0) && (!emailPattern.test(email))){
										// 	valid += '<p> Proper email format required. </p>';
										// 	$('#editUserForm_email').next('div[class="validation"]').text('Proper email format required.');
										// } else if ((jQuery.inArray(email, editUsers_existingUserEmails) >= 0) && (currentEmail != editUsers_existingUserEmails[(jQuery.inArray(email, editUsers_existingUserEmails))])) {
										// 	valid += '<p> This email has been taken. </p>';
										// 	$('form[id="editUserForm"] #editUserForm_email').next('div[class="validation"]').text('This email has been taken.');
										// } else {
										// 	$('form[id="editUserForm"] #editUserForm_email').next('div[class="validation"]').text('');	
										// }

										// if(password == ''){
										// 	valid += '<p> Password is required. </p>';
										// 	$('form[id="editUserForm"] #editUserForm_hashed_password').next('div[class="validation"]').text('Password is required.');
										// } else {
										// 	$('form[id="editUserForm"] #editUserForm_hashed_password').next('div[class="validation"]').text('');	
										// }

										// if(passwordConfirmation == ''){
										// 	valid += '<p> Password Confirmation is required. </p>';
										// 	$('form[id="editUserForm"] #editUserForm_name').next('div[class="validation"]').text('');
										// } else {
										// 	$('form[id="editUserForm"] #editUserForm_name').next('div[class="validation"]').text('');	
										// }

										// if(password != passwordConfirmation){
										// 	valid += '<p> Password and Password Confirmation don\'t match.</p>';
										// 	$('form[id="editUserForm"] #editUserForm_passwordConfirmation').next('div[class="validation"]').text('Password and Password Confirmation don\'t match.');	
										// } else {
										// 	$('form[id="editUserForm"] #editUserForm_passwordConfirmation').next('div[class="validation"]').text('');	
										// }	

										// if(club == ''){
										// 	valid += '<p> A club is required. </p>';
										// 	$('form[id="editUserForm"] #editUserForm_club').next('div[class="validation"]').text('A club is required.');
										// } else {
										// 	$('form[id="editUserForm"] #editUserForm_club').next('div[class="validation"]').text('');	
										// }

										// if(jQuery.inArray(club, validClubs) == -1){
										// 	valid += '<p> Invalid club selected. </p>';
										// 	$('form[id="editUserForm"] #editUserForm_club').next('div[class="validation"]').text('Invalid club selected.');
										// } else {
										// 	passwordIndex = jQuery.inArray(club, validClubs);
										// 	clubPasswordVerification = clubAndPassword[passwordIndex];
										// 	$('form[id="editUserForm"] #editUserForm_club').next('div[class="validation"]').text('');	
										// }

										// if(clubPassword == ''){
										// 	valid += '<p> Please enter a club password. </p>';
										// 	$('form[id="editUserForm"] #editUserForm_clubPassword').next('div[class="validation"]').text('Please enter a club password.');
										// } else {
										// 	$('form[id="editUserForm"] #editUserForm_clubPassword').next('div[class="validation"]').text('');	
										// }

										// if(clubPassword != clubPasswordVerification){
										// 	valid += '<p> Invalid club password. </p>';
										// 	$('form[id="editUserForm"] #editUserForm_clubPassword').next('div[class="validation"]').text('Invalid club password.');
										// } else {
										// 	$('form[id="editUserForm"] #editUserForm_clubPassword').next('div[class="validation"]').text('');	
										// }

										// if(role == ''){
										// 	valid += '<p> A role is required. </p>';
										// 	$('form[id="editUserForm"] #editUserForm_role').next('div[class="validation"]').text('A role is required.');
										// } else if((role < 1) || (role > 4)){
										// 	valid += '<p> Please select a proper user role. </p>';
										// 	$('form[id="editUserForm"] #editUserForm_role').next('div[class="validation"]').text('Please select a proper user role.');
										// } else {
										// 	$('form[id="editUserForm"] #editUserForm_role').next('div[class="validation"]').text('');	
										// }	
										
										// if(valid.length > 0){
										// 	$('div[class="alert alert-error"]').remove();
										// 	$('div[class="alert alert-success"]').remove();
										// 	errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
										// 	$("#registerErrorMessages").append(errorDisplay);
										// 	$('#registerErrorMessages').removeAttr('style');
										// 	$('#registerErrorMessages').fadeOut(2000);
										// } else {
										// 	editFormData = $('form[id="editUserForm"]').serialize();
										// 	// alert(editFormData);
										// 	submitUserEditData(editFormData);
										// }
									});*/
								</script>
							</div>
							<div class='span6'>
								<button id="cancelUserSubmit" class='btn btn-primary' type='button'>Cancel</button>
								<script>
									$('#cancelUserSubmit').click(function(e){
										$("#addEditUserBlock").load('uploadUser.php');
									});
								</script>
							</div>
						</div>
				</fieldset>
			</form>	
		</div>
<?php

} else if (isset($_POST['submit'])){

	foreach($required_fields as $required_field){
		if(!(isset($_POST[$required_field])) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
			$error[] = $required_field . ' is a required field';
		}
	}

	if(empty($errors)){
		$id = mysql_real_escape_string(htmlspecialchars($_POST['id']));
		$un = mysql_real_escape_string(htmlspecialchars($_POST['editUserForm_username']));
		$pw = mysql_real_escape_string(htmlspecialchars($_POST['editUserForm_hashed_password']));
		$fn = mysql_real_escape_string(htmlspecialchars($_POST['editUserForm_first_name']));
		$ln = mysql_real_escape_string(htmlspecialchars($_POST['editUserForm_last_name']));
		$e = mysql_real_escape_string(htmlspecialchars($_POST['editUserForm_email']));
		$r = mysql_real_escape_string(htmlspecialchars($_POST['editUserForm_role']));
		$c = mysql_real_escape_string(htmlspecialchars($_POST['editUserForm_club']));


		$pw = sha1('X101' . $pw . 'X101');

		$newUser = User::register($un, $pw, $fn, $ln, $e, $r, $c);
		$newUser->id = $id;
		if($newUser->save()){
			redirect_to("userListing.php");
		} else {
			die("Cannot register user. " . mysql_error());
		}
	} else {
		foreach($errors as $error){
			echo $error . '</br></br>' ;
		}
	}
}

?>


<script>
	function submitUserEditData(formData){
		$.ajax({
			type:'POST',
			url: 'editUser.php',
			data:formData,
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
				$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">User modified!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#users").load("userALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">User could not be modified.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="editUserForm"]')[0].reset();
			}
		});
	};
</script>