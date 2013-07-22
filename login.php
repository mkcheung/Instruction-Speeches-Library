<?php
require_once("DatabaseObject.php");
require_once("database.php");
require_once("constants.php");
require_once("user.php");
require_once("userrole.php");
require_once("Club.php");
require_once("function.php");
require_once("Session.php");
include_once("header.php");

$userRoles = UserRole::find_all();
$clubs = Club::find_all();
$required_fields = array('username','password');
$required_fields_register = array('username','first_name','last_name','hashed_password', 'email', 'role', 'club');
$errors = array();
?>
<script>
	var fieldsForValidation = Array('usernameRegistration','first_name','last_name','hashed_password', 'email', 'role', 'clubPassword');
</script>
<?php


if($_GET['kickoutStatus'] == 1)
{
		?>
		<script>
			$('div[class="alert alert-error"]').remove();
			$('div[class="alert alert-success"]').remove();
			$('#registerErrorMessages').append('<div class="alert alert-error"><?=$_GET["flashMessage"]?></div>');
			$('#registerErrorMessages').removeAttr('style');
			$('#registerErrorMessages').fadeOut(2000);
		</script>
		<?php
}

if(isset($_POST['login'])){

	$un = mysql_real_escape_string($_POST['username']);
	$pw = mysql_real_escape_string($_POST['password']);

	$user = User::authenticate($un, $pw);

	$result = $SESS->login($user);

	if($result == true){
		redirect_to('index.php');
	} else {
		?>
			<script>
				$('div[class="alert alert-error"]').remove();
				$('div[class="alert alert-success"]').remove();
				errorDisplay = '<div class="alert alert-error">Incorrect username or password.</div>';
				$('#registerErrorMessages').append(errorDisplay);
				$("#registerErrorMessages").removeAttr('style');
				$('#registerErrorMessages').fadeOut(2000);
			</script>
		<?php
	}
} else if(isset($_POST['submit'])){

	foreach($required_fields_registers as $required_fields_register){
		if(!(isset($_POST[$required_fields_register])) || (empty($_POST[$required_fields_register]) && is_numeric($_POST[$required_fields_register]))){
			$error[] = $required_fields_register . ' is a required field';
		}
	}

	if(empty($errors)){

		$un = mysql_real_escape_string(htmlspecialchars($_POST['usernameRegistration']));
		$pw = mysql_real_escape_string(htmlspecialchars($_POST['hashed_password']));
		$fn = mysql_real_escape_string(htmlspecialchars($_POST['first_name']));
		$ln = mysql_real_escape_string(htmlspecialchars($_POST['last_name']));
		$e = mysql_real_escape_string(htmlspecialchars($_POST['email']));
		$r = mysql_real_escape_string(htmlspecialchars($_POST['role']));
		$c = mysql_real_escape_string(htmlspecialchars($_POST['club']));


		$newUser = User::register($un, $pw, $fn, $ln, $e, $r, $c);
		if($newUser->save()){
			//redirect_to("redirect2.php");
		} else {
			die("Cannot register user. " . mysql_error());
		}
	}
	else {
		foreach($errors as $error){
			echo $error . '</br></br>' ;
		}
	}
}



?>		
	<script>
		// javascript variables
		var validClubs = Array();
		var clubAndPassword = Array();
	</script>	

	<script>
		// $('#loginForm').submit(function(e){
			$('#loginForm').on("click","#loginSubmit", function(e){
			e.preventDefault();
			var uname = $('#loginForm #username').val();
			var pword = $('#loginForm #password').val();
			var valid = '';

			if(uname.length == 0){
				valid += '<p>Please enter a username.</p>';
			}
			if(pword.length == 0){
				valid += '<p>Please enter password.</p>';
			}

			if (valid.length>0){
				$('div[class="alert alert-error"]').remove();
				$('div[class="alert alert-success"]').remove();
				$('#registerErrorMessages').append('<div class="alert alert-error">' + valid + '</div>');
				$("#registerErrorMessages").removeAttr('style');
				$('#registerErrorMessages').fadeOut(2000);
			} else {
				$('#loginForm').submit();
			}
		});
	</script>
	<div class="container">

		<div class="row-fluid" style="min-height:500px">
			<div class="span6">
				<h1>The Toastmasters Library!</h1>
				<div class="row-fluid">
					<div class="span6">
						<img style="padding-left:105px;" src="../img/Books-1-icon.png">
					</div>
					<div class="span6">
					</div>
				</div>
			</div>
			<div class="span6">
				<div id="registration">
		  			<script>
			  			$('#loginOrRegister').click(function() {
						  $('#theLogin').toggle('slow');
						  $('#theRegistration').toggle('slow');
						  if($('#loginOrRegister').text() == 'Login'){
						  		$('#loginOrRegister').text('Register');
						  } else {
						  	$('#loginOrRegister').text('Login');
						  }
						});
		  			</script>
					<div id="theLogin" style="display:block;">
						<form action="login.php" method="post" id="loginForm">
							<fieldset>
								<legend>Login</legend>
								<div class="row-fluid">
									<div class="span6">
										<label for="username">User Name:</label>
					    				<input class="text" type="text" id="username" name="username"/>
					    			</div>
					    			<div class="span6">
					    				<label for="password">Password:</label>
					    				<input class="text" type="password" id="password" name="password"/>
					    			</div>
					    		</div>
								<input id="login" name="login" type="hidden" value="1"/>
					    		<input type="submit"  id="loginSubmit" class="btn btn-primary pull-right"/>
				    		</fieldset>
				    	</form>
				    </div>
				    <div id="theRegistration" style="display:none;">
						<form action="register.php" method="post" id="userRegistrationForm">
							<fieldset>
								<legend>User Registration</legend>
								<input  type="hidden" id="submit2" name="submit"/>
								<div class="row-fluid">
									<div class="span6">
										<label for="first_name">First Name:</label>
										<input class="text" type="text" id="first_name" name="first_name"/>
					    				<div style="color:red; font-size:12px;" class="validation"></div>
									</div>
									<div class="span6">
										<label for="last_name">Last Name:</label>
										<input class="text" type="text" id="last_name" name="last_name"/>
					    				<div style="color:red; font-size:12px;" class="validation"></div>
									</div>
								</div>
								<div class="row-fluid">
									<div class="span6">
										<label for="usernameRegistration">User Name:</label>
										<input class="text" type="text" id="usernameRegistration" name="username"/>
					    				<div style="color:red; font-size:12px;" class="validation"></div>
									</div>
									<div class="span6">
										<label for="email">Email:</label>
										<input class="text" type="email" id="email" name="email"/>
					    				<div style="color:red; font-size:12px;" class="validation"></div>
									</div>
								</div>
								<div class="row-fluid">
									<div class="span6">
										<label for="password">Password:</label>
										<input class="text" type="password" id="hashed_password" name="hashed_password"/>
					    				<div style="color:red; font-size:12px;" class="validation"></div>
									</div>
									<div class="span6">
										<label for="passwordConfirmation">Password Confirmation:</label>
										<input class="text" type="password" name="passwordConfirmation" id="passwordConfirmation"/>
									</div>
								</div>
								<div class="row-fluid">
									<div class="span6">
										<label for="club">Club:</label>
										<select id="club" name="club">
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
									</div>
									<div class="span6">
										<label for="clubPassword">Club Password:</label>
										<input class="text" type="password" name="clubPassword" id="clubPassword"/>
				    					<div style="color:red; font-size:12px;" class="validation"></div>
									</div>
								</div>
								<div class="row-fluid">
									<div class="span6">
										<input id="role" type = "hidden" name="role" value="2">
									</div>
									<div class="span6">
										<input id="registerSubmit" type="submit" name="submit" class="btn btn-primary pull-right"/>
										<script>

											$('#userRegistrationForm input').blur(function(){
												var id = $(this).attr('id');
												var value = $(this).val();
												var emailPattern = /[a-zA-Z0-9]*@[a-zA-Z0-9]*\.[com]/;
												switch(id){
													case 'usernameRegistration':
														if (value.length == 0){
															$(this).siblings('div[class="validation"]').text('User Name is required.');
														} else {
															$(this).siblings('div[class="validation"]').text('');
														}
														break;
													case 'first_name':
														if (value.length == 0){
															$(this).siblings('div[class="validation"]').text('First Name is required.');
														} else {
															$(this).siblings('div[class="validation"]').text('');
														}
														break;
													case 'last_name':
														if (value.length == 0){
															$(this).siblings('div[class="validation"]').text('Last Name is required.');
														} else {
															$(this).siblings('div[class="validation"]').text('');
														}
														break;
													case 'hashed_password':
														if (value.length == 0){
															$(this).siblings('div[class="validation"]').text('Password is required.');
														} else if ((value.length > 0) && (value !== $('#passwordConfirmation').val())){
															$(this).siblings('div[class="validation"]').text('Password must match confirmation.');
														} else {
															$(this).siblings('div[class="validation"]').text('');
														}
														break;
													case 'passwordConfirmation':
														if ((value.length > 0) && (value !== $('#hashed_password').val())){
															$('#hashed_password').siblings('div[class="validation"]').text('Password must match confirmation.');
														} else {
															$('#hashed_password').siblings('div[class="validation"]').text('');
														}
														break;
													case 'email':
														if (value.length == 0){
															$(this).siblings('div[class="validation"]').text('Email is required.');
														} else if ((value.length > 0) && (!emailPattern.test(value))){
															$(this).siblings('div[class="validation"]').text('Proper email format required.');
														} else {
															$(this).siblings('div[class="validation"]').text('');
														}
														break;
													case 'clubPassword':
														if (value.length == 0){
															$(this).siblings('div[class="validation"]').text('Club password is required.');
														} else {
															$(this).siblings('div[class="validation"]').text('');
														}
														break;
												}
											});

											$('#registerSubmit').click(function(e){
												e.preventDefault();
												e.stopPropagation();

												// alert('5');

												var valid = '';
												var errorDisplay = '' ;
												var required = ' is required.';
												var username = $('form[id="userRegistrationForm"] #usernameRegistration').val();
												var firstname = $('form[id="userRegistrationForm"] #first_name').val();
												var lastname = $('form[id="userRegistrationForm"] #last_name').val();
												var email = $('form[id="userRegistrationForm"] #email').val();
												var password = $('form[id="userRegistrationForm"] #hashed_password').val();
												var passwordConfirmation = $('form[id="userRegistrationForm"] #passwordConfirmation').val();
												var club = $('form[id="userRegistrationForm"] #club').val();
												var clubPassword = $('form[id="userRegistrationForm"] #clubPassword').val();
												var role = $('form[id="userRegistrationForm"] #role').val();
												var emailPattern = /[a-zA-Z0-9]*@[a-zA-Z0-9]*\.[com]/;

												if(username == ''){
													valid += '<p> Username is required. </p>';
													$('form[id="userRegistrationForm"] #usernameRegistration').siblings('div[class="validation"]').text('User Name is required.');
												}

												if(firstname == ''){
													valid += '<p> A First Name is required. </p>';
													$('form[id="userRegistrationForm"] #first_name').siblings('div[class="validation"]').text('First name is required.');

												}

												if(lastname == ''){
													valid += '<p> A Last Name is required. </p>';
													$('form[id="userRegistrationForm"] #last_name').siblings('div[class="validation"]').text('Last name is required.');
												}

												if(email == ''){
													valid += '<p> Email is required. </p>';
													$('form[id="userRegistrationForm"] #email').siblings('div[class="validation"]').text('Email is required.');
												} else if ((email.length > 0) && (!emailPattern.test(email))){
													$('form[id="userRegistrationForm"] #email').siblings('div[class="validation"]').text('Proper email format required.');
												}

												if(password == ''){
													valid += '<p> Password is required. </p>';
													$('form[id="userRegistrationForm"] #hashed_password').siblings('div[class="validation"]').text('Password is required.');
												} else if (password !== passwordConfirmation){
													valid += '<p> Password must match confirmation. </p>';
													$('form[id="userRegistrationForm"] #hashed_password').siblings('div[class="validation"]').text('Password must match confirmation.');
												} else {
													$('form[id="userRegistrationForm"] #hashed_password').siblings('div[class="validation"]').text('');													
												}

												if(passwordConfirmation == ''){
													valid += '<p> Password Confirmation is required. </p>';
												}	

												if(password != passwordConfirmation){
													valid += '<p> Password and Password Confirmation don\'t match.</p>';
												}	

												if(club == ''){
													valid += '<p> A club is required. </p>';
												}	

												if(jQuery.inArray(club, validClubs) == -1){
													valid += '<p> Invalid club selected. </p>';
												} else {
													passwordIndex = jQuery.inArray(club, validClubs);
													clubPasswordVerification = clubAndPassword[passwordIndex];
												}

												if(clubPassword == ''){
													valid += '<p> Please enter a club password. </p>';
												}

												if(clubPassword != clubPasswordVerification){
													valid += '<p> Invalid club password. </p>';
													$('form[id="userRegistrationForm"] #clubPassword').siblings('div[class="validation"]').text('Club password is required.');
												}

												if(role == ''){
													valid += '<p> A role is required. </p>';
													$('form[id="userRegistrationForm"] #role').siblings('div[class="validation"]').text('A role is required.');

												}		

												if((role < 1) || (role > 4)){
													valid += '<p> Please select a proper user role. </p>';
												}

												if(valid.length > 0){
													$('div[class="alert alert-error"]').remove();
													$('div[class="alert alert-success"]').remove();
													errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
													$("#registerErrorMessages").append(errorDisplay);
													$("#registerErrorMessages").removeAttr('style');
													$("#registerErrorMessages").fadeOut(2000);
												} else {
													userFormData = $('form[id="userRegistrationForm"]').serialize();
													submitUserData(userFormData);
												}
											});

											function submitUserData(formData){
												$.ajax({
													type:'POST',
													url: 'login.php',
													data:formData,
													cache: false,
													timeout:7000,
													processData:true,
													success: function(data){
														$('div[class="alert alert-error"]').remove();
														$('div[class="alert alert-success"]').remove();
														$('#registerErrorMessages').append('<div class="alert alert-success">User registered!</div>');
														$('#registerErrorMessages').removeAttr('style');
														$('#registerErrorMessages').fadeOut(2000);

													},
													error: function(XMLHttpRequest, textStatus, errorThrown){
														$('#registerErrorMessages div[class="alert alert-error"]').remove();
														$("#registerErrorMessages").append('<div class="alert alert-error">The user could not be registered.</div>');
														$("#registerErrorMessages").removeAttr('style');
														$("#registerErrorMessages").fadeOut(2000);
													},
													complete: function(XMLHttpRequest, status){
														$('form[id="userRegistrationForm"]')[0].reset();
													}
												});
											};
									</script>

									</div>
								</div>
							</fieldset>
						</form>
					</div>	
				</div>
			</div>
		</div>
		<div class="row-fluid">
			<div class="span4">
				<h2>Examples</h2>
				<p>
					Would you like to see an icebreaker? Care to see how someone does a comedic speech? You've come to the right place!
				</p>
			</div>
			<div class="span4">
				<h2>Evaluations</h2>
				<p>
					Having trouble keeping your evaluations in order? Want to be evaluated by not only your club but from those all around the county? Come on in!
				</p>
			</div>
			<div class="span4">
				<h2>Participate</h2>
				<p>
					Share your opinions and evaluations with your local Toastmasters community! Offer insight into the speeches of your peers and let them know about the latest events going on.
				</p>
			</div>
		</div>
	</div>	
<?php
	include_once("footer.php");
?>
